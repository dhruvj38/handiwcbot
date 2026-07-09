const { exec } = require('child_process');

exec('npx eslint src/services/ai/AiService.ts', (error, stdout, stderr) => {
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);
});
