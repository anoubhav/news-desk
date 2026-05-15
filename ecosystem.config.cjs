module.exports = {
  apps: [
    {
      name: "live-avatar-election-desk",
      cwd: "/home/anokitv/anoubhav/live_avatar",
      script: "npm",
      args: "run serve",
      kill_timeout: 5000,
      env: {
        HOST: "127.0.0.1",
        PORT: "4175",
      },
    },
    {
      name: "live-avatar-tunnel",
      cwd: "/home/anokitv/anoubhav/live_avatar",
      script: "./bin/cloudflared",
      args: "tunnel --url http://127.0.0.1:4175 --no-autoupdate",
      kill_timeout: 5000,
    },
  ],
};
