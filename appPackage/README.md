# Teams app package

`manifest.json` is an environment-templated manifest. Before sideloading, replace:

- `${{TEAMS_APP_ID}}` with the Teams app ID
- `${{BOT_ID}}` with the Teams/Bot registration ID used for messaging
- `${{TAB_DOMAIN}}` with the externally reachable HTTPS host
- `${{CLIENT_ID}}` with the Microsoft Entra application (client) ID
- `${{APPLICATION_ID_URI}}` with the Application ID URI from `Expose an API`

For a Teams SDK app that combines a bot and a tab, `webApplicationInfo.id` identifies the Entra app that issues the tab token, while `webApplicationInfo.resource` must be the bot resource URI `api://botid-${{BOT_CLIENT_ID}}`. Configure that URI, the `access_as_user` scope, Teams Web/Desktop preauthorization, and the Bot Framework redirect URI on the bot Entra app before uploading. The local MVP can be runtime-verified without sideloading by using `TEAMS_SKIP_AUTH=true` and the HTTP checks documented in the project README.
