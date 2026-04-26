const query = `query { MediaListCollection(userName: "akmoid3", type: ANIME, status: COMPLETED) { lists { entries { media { title { romaji } characters(sort: ROLE, perPage: 3) { nodes { name { full } image { large } } } } } } } }`;
fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  body: JSON.stringify({ query })
}).then(r => r.json()).then(data => console.log(JSON.stringify(data).substring(0, 500))).catch(e => console.error(e));
