#!/bin/env node
import Docker from 'dockerode'
import axios from 'axios'

import config from './config.js'

const docker = new Docker();

console.log("monitoring container deaths");
docker.getEvents((err, stream)=>{
  if(err) console.error(err);
  stream.on('data', async chunk=>{

    try {

      const event = JSON.parse(chunk.toString('utf8'));
      if(event.Type != "container") return;
      if(event.Action != "die") return;
      console.debug(event);

      const container = docker.getContainer(event.id);
      const info = await container.inspect();
      const logs = await container.logs({ stdout: true, stderr: true, tail: 50, });

      const msg = `
  --- container died -- 
  - ${info.Name} (restartcount: ${info.RestartCount})--
  ${JSON.stringify(info.State, null, 4)}

  - logs (${info.LogPath})-
  ${logs.toString("utf8")}
      `;
      console.debug(msg);

      //ship it to slack
      await axios.post(config.slackURL, { text: msg, });

    } catch (err) {
      console.error(err);
    }
  });
});

