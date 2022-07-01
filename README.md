# notif

Prototype to detect Docker container restarts and notify someone.

Create `config.js` with the slack hook end point

```
export default {
  slackURL: "https://hooks.slack.com/services/xxxxxx",
}
```

Usage:
```
npm i
node monitor.js
```
