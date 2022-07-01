import stream from 'stream';
import { program } from 'commander';
import Docker from "dockerode";


program
  .name('notif')
  .description('Tool to notify when a container dies.')
  .version('1.0.0')
  .option('-t, --tail <n>', 'Number of log lines before/during crash to report')
  .parse();

const options = program.opts();
const tail = +(options.tail || '100');

// Get docker client from env
const docker = new Docker();
const containers = {};

async function readLogs(container) {
  // Some witchery to convert Docker log format to string
  const clogBuffer = await container.logs({
    stdout: true,
    stderr: true,
    timestamps: true,
    tail: tail,
  });
  const clogStream = new stream.Readable({
    read() {
      this.push(clogBuffer);
      this.push(null);
    }
  });

  const logStream = new stream.PassThrough();
  container.modem.demuxStream(clogStream, logStream, logStream);

  clogStream.on('end', () => {
    logStream.end();
  });

  return await new Promise((resolve, reject) => {
    const chunks = [];
    logStream.on("data", chunks.push.bind(chunks));
    logStream.on("end", () => {
      resolve(Buffer.concat(chunks).toString());
      clogStream.destroy();
    });
    logStream.on("error", (err) => {
      reject(err);
      clogStream.destroy();
    });
  });
}

function canRestart(restartPolicy) {
  return (
    restartPolicy === "always" ||
    restartPolicy.startsWith("on-failure") ||
    restartPolicy === "unless-stopped"
  );
}


try {

  // A container lifecycle: https://miro.medium.com/max/1129/1*vca4e-SjpzSL5H401p4LCg.png

  // Init already running container
  const runningContainers = await docker.listContainers({ all: false });
  for (const container of runningContainers) {
    const { Id, Names, Image, State } = container;
    const Name = Names[0].substring(1);
    const inspection = await docker.getContainer(Id).inspect();
    const { RestartCount } = inspection;
    const restartPolicy = inspection.HostConfig.RestartPolicy.Name;

    if (canRestart(restartPolicy)) {
      containers[container.Id] = {
        Image,
        Name,
        Action: State === "restarting" ? "die" : "start",
        RestartCount,
      };
    }
  }

  // Assumes that the host will not be crazy running a lot of containers
  // i.e. no filter per container
  const events = await docker.getEvents({
    filters: {
      type: ["container"],
      event: ["start", "die", "restart", "kill", "oom", "pause", "unpause", "destroy"],

    }
  });

  for await (const marsheled of events.iterator()) {
    const event = JSON.parse(marsheled);
    const { id, Action } = event;
    if (Action === "start") {

      // The container can fail fast, so being precautious here
      try {
        const container = docker.getContainer(id);

        // So we reach this part here, we know there's a container,
        // we need to check that it died by natural causes.
        // "die" → "start"
        if (containers[id] && containers[id].Action === "die") {
          containers[id].Action = Action;
          containers[id].RestartCount++; // May be an underestimation

          const logs = await readLogs(container);

          const times = containers[id].RestartCount > 1 ?
            `(${containers[id].RestartCount} times)` :
            "once";

          // TODO Notify the dudes and dudesses
          console.log(
            `Container ${containers[id].Name} (${container.id})[${containers[id].Image}] ` +
            `may have died (${times}), its last words:`
          );
          console.log(logs);


          // If the container is not in memory yet, store it
        } else if (!containers[id]) {
          const inspection = await container.inspect();
          const { Names, Image, RestartCount } = inspection;
          const Name = Names[0].substring(1);
          const restartPolicy = inspection.HostConfig.RestartPolicy.Name;

          // Just care about the ones that are set to restart
          if (canRestart(restartPolicy)) {
            containers[id] = {
              Image,
              Name,
              Action,
              RestartCount,
            };
          }
        }

      } catch (error) {
        // The container went berserk
        const Name = containers[id].Name || "unknown";
        const Image = containers[id].Image || "unknown";

        // TODO Notify the dudes and dudesses
        console.log(`Container ${Name} (${id})[${Image}] may have died, and it is failing fast.`);
        console.log(error);
      }

      // Cleanup
    } else if (Action === "destroy") {
      if (containers[id]) {
        delete containers[id];
      }

      // Make sure we have the last status of the container
    } else {
      if (containers[id]) {
        containers[id].Action = Action;
      }
    }
  };
} catch (error) {
  console.error(error);
  exit(1);
}