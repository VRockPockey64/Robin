# Robin

Quality-of-life tools for observability teams.

Robin is a Dynatrace custom app for reducing repetitive observability and promotion work. It includes helpers for telemetry samples, workflow and SRG JSON handling, dashboard ownership tasks, migration preparation, JSON cleanup, and WCCS library validation.

The backend uses Dynatrace SDK clients and the current user's/app's granted scopes:

- `businessEventsClient.ingest` for business events
- `logsClient.storeLog` for logs
- Dynatrace AppEngine functions for guarded backend operations

## Available Scripts

In the project directory, you can run:

### `npm run start`

Runs the app in development mode. A new browser window with your running app will be automatically opened.

### `npm run build`

Builds the app for production to the `dist` folder.

### `npm run deploy`

Builds the app and deploys it to the specified environment in `app.config.json`.

### `npm run uninstall`

Uninstalls the app from the specified environment in `app.config.json`.

### `npm run create:function`

Generates a new serverless function for your app in the `api` folder.

### `npm run update`

Updates @dynatrace-scoped packages to the latest version and applies automatic migrations.

### `npm run info`

Outputs the CLI and environment information.

### `npm run help`

Outputs help for the Dynatrace App Toolkit.
