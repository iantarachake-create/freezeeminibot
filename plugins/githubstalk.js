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

        let user = null;
        try {
            const response = await axios.get(`https://api.github.com/users/${encodeURIComponent(q.trim())}`, { headers: { 'User-Agent': 'freezer-minibot', Accept: 'application/vnd.github+json' }, timeout: 20000 });
            user = response.data;
        } catch (err) {
            if (err.response?.status !== 404) throw err;
        }

        if (user && user.login) {

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
