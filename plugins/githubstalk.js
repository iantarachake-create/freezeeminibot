const { cmd } = require('../command');
const axios = require('axios');

cmd({
    pattern: "githubstalk2",
    alias: ["github2", "ghstalk", "gitstalk"],
    desc: "Stalk a GitHub user profile",
    category: "search",
    react: "🔍",
    filename: __filename
}, async (conn, mek, m, { from, text, q }) => {
    try {

        if (!q) {
            return await conn.sendMessage(from, {
                text:
`🌸 *GitHub Stalk* 🌸

✿ Username required  
✿ Example: *.githubstalk freezermd*`
            }, { quoted: mek });
        }

        await conn.sendMessage(from, {
            text: `🌼 Fetching GitHub profile…`
        }, { quoted: mek });

        const apiUrl = `https://apis.davidcyriltech.my.id/githubStalk?user=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl);
        const data = response.data;

        if (data.status === 200 && data.success) {
            const user = data.result;

            let stalkMsg =
`🌸 *GitHub Profile* 🌸

✿ *Name:* ${user.name || 'Not set'}
✿ *User:* ${user.login}
✿ *Bio:* ${user.bio || 'No bio'}

🌼 *Stats* 🌼
✿ Repos: ${user.public_repos}
✿ Followers: ${user.followers}
✿ Following: ${user.following}

🌷 *Location:* ${user.location || 'Unknown'}
🌷 *Company:* ${user.company || 'None'}

🔗 ${user.html_url}

🌸 _Freezer MD_`;

            await conn.sendMessage(from, {
                image: { url: user.avatar_url },
                caption: stalkMsg
            }, { quoted: mek });

        } else {
            return await conn.sendMessage(from, {
                text:
`🌸 *Not Found* 🌸

✿ User does not exist  
✿ Check username & retry`
            }, { quoted: mek });
        }

    } catch (e) {
        console.error("GitHub Stalk Error:", e);
        await conn.sendMessage(from, {
            text:
`🌸 *Error* 🌸

✿ Failed to fetch profile  
✿ Try again later`
        }, { quoted: mek });
    }
});
