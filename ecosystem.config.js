module.exports = {
  apps: [{
    name: 'freezer-minibot',
    script: 'index.js',
    instances: 1,            // keep 1: a WhatsApp session must live in exactly one process
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '900M',
    restart_delay: 3000,
    exp_backoff_restart_delay: 200,
    kill_timeout: 8000
  }]
};
