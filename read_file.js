const fs = require('fs');
const path = 'c:\\Users\\zhifs\\Documents\\handiwcbot\\dashboard\\src\\app\\guilds\\[guildId]\\logs\\page.tsx';
try {
    const content = fs.readFileSync(path, 'utf8');
    console.log(content);
} catch (err) {
    console.error(err);
}
