import Docker from 'dockerode'
import axios from 'axios'

import config from './config.js'

const docker = new Docker();

console.log("monitoring container deaths");
docker.getEvents((err, stream)=>{
  if(err) console.error(err);
  stream.on('data', async chunk=>{
    const event = JSON.parse(chunk.toString('utf8'));
    if(event.Type != "container") return;
    if(event.Action != "die") return;
    console.debug(event);

    //get a bit more container info
    const container = docker.getContainer(event.id);
    const info = await container.inspect(container);

    //dump recent logs
    const logs = await container.logs({ stdout: true, stderr: true, timestamps: true, tail: 50, });

    //construct message to send
    const msg = `
--- container died -- 
- ${info.Name} (restartcount: ${info.RestartCount})--
${JSON.stringify(info.State, null, 4)}

- logs (${info.LogPath})-
${logs.toString("utf8")}
    `;
    console.debug(msg);

    //ship it
    try {
      const res = await axios.post(config.slackURL, {
        text: msg, 
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
      });
      console.debug("posted to slack");
      console.dir(res);
    } catch (err) {
      console.error(err);
    }
  });
});

