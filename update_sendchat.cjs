const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// The regex will look for sendChatMessage(`something`)
// If something contains ${chatterName}, we append , chatterName
code = code.replace(/sendChatMessage\(\`([^`]*\$\{chatterName\}[^`]*)\`\)/g, 'sendChatMessage(`$1`, chatterName)');
code = code.replace(/sendChatMessage\(\`([^`]*\$\{target\}[^`]*)\`\)/g, 'sendChatMessage(`$1`, target)');
code = code.replace(/sendChatMessage\(\`([^`]*\$\{targetUser\}[^`]*)\`\)/g, 'sendChatMessage(`$1`, targetUser)');
code = code.replace(/sendChatMessage\(\`([^`]*\$\{fish\.username\}[^`]*)\`\)/g, 'sendChatMessage(`$1`, fish.username)');

// Also replace standard string concatenation if any
code = code.replace(/sendChatMessage\(chatterName \+([^)]*)\)/g, 'sendChatMessage(chatterName +$1, chatterName)');

fs.writeFileSync('app.js', code);
console.log('Done replacing!');
