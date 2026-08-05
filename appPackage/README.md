# Teams app package

`manifest.json` is an environment-templated manifest. Before sideloading, replace:

- `${{TEAMS_APP_ID}}` with the Teams app ID
- `${{BOT_ID}}` with the bot/Entra app ID
- `${{TAB_DOMAIN}}` with the externally reachable HTTPS host
- `${{CLIENT_ID}}` with the Microsoft Entra application (client) ID
- `${{APPLICATION_ID_URI}}` with the Application ID URI from `Expose an API`

The manifest's `webApplicationInfo` connects the tab SSO configuration to the Entra app registration. The local MVP can be runtime-verified without sideloading by using `TEAMS_SKIP_AUTH=true` and the HTTP checks documented in the project README.
