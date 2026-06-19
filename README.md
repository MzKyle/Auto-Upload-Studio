# Data Collection Uploader

[English](README.md) | [简体中文](README.zh-CN.md)

![Data Collection Uploader](docs/assets/cover.svg)

Data Collection Uploader is an Electron desktop application for reliably archiving
industrial collection data to Aliyun OSS, Tencent TurboS3, or both clouds. It discovers
stable welding-session directories, schedules resumable upload tasks, tracks each cloud
independently, and closes completed date directories for retention and cleanup.

[Read the documentation](docs/README.md)

## What You Can Do

- Scan one or more data roots organized as `YYYY-MM-DD/weld-session/files`.
- Wait for repeated size and modification-time snapshots before registering a directory.
- Upload to Aliyun only, Tencent only, or both providers.
- Track progress, errors, completion, and retries independently for each provider.
- Pause, resume, cancel, and retry an individual failed cloud destination.
- Restrict new task starts to a daily or overnight upload window.
- Pull remote data with `rsync`, or send smaller remote files directly through SFTP.
- Export image annotations as PNG + JSON and upload them to the active providers.
- Keep task, destination, file, date-summary, settings, and remote-machine state in SQLite.
- Delete completed local data after a configurable retention period.

## Upload Model

Configure the parent directory of the date folders:

```text
/data/upload-root/
  2026-06-18/
    04-39-04/
      camera1/0001.jpg
      metadata.json
```

Each direct child of a valid `YYYY-MM-DD` folder becomes one upload task after it is
stable. Files placed directly in the date folder are not uploaded.

Each provider has its own prefix. With `upload/` as the prefix, object keys are:

```text
upload/2026-06-18/04-39-04/camera1/0001.jpg
upload/2026-06-18/04-39-04/metadata.json
```

The upload mode and both prefixes are captured when a task is created. Changing settings
later affects new tasks only. In dual-cloud mode, a logical file and task complete only
after both destinations complete. Retrying one failed destination does not resend files
that already succeeded on the other provider.

After the date has passed and every discovered welding session is complete,
`day_upload.json` is written in the date directory. If a late session appears, the date
is reopened automatically, the new session is uploaded, and the date is closed again.

## Cloud Providers

| Provider | Client and behavior |
| --- | --- |
| Aliyun OSS | `ali-oss`; streaming upload for small files and multipart upload for large files |
| Tencent TurboS3 | AWS SDK v3 S3 client; Signature V4, path-style requests, and multipart upload |

Tencent TLS certificate verification is enabled by default. The insecure TLS option is
intended only for a controlled environment that uses an unverifiable self-signed
certificate.

Connection tests list at most one object from the configured bucket. A successful test
does not replace the need for object-write and multipart-upload permissions.

## Remote Transfer and Annotation

| Feature | Behavior |
| --- | --- |
| `rsync` | Pulls to a local directory, then creates a normal resumable upload task |
| SFTP | Reads each remote file into memory and uploads it to the currently selected providers |
| Annotation | Exports PNG + JSON and uploads both files to the currently selected providers |

SFTP and annotation operations return a result for each provider, but they do not create
normal task-history records. For large files or unreliable networks, prefer `rsync` so
the regular task runner can use local recovery and multipart uploads.

## Install and Run

Requirements:

- Node.js 18 or later; Node.js 20 LTS is recommended
- npm 9 or later
- Linux or Windows
- Credentials with access to at least one configured object-storage bucket
- Optional: `rsync` and `sshpass` for remote pull workflows

```bash
npm install
npm run dev
```

In **Settings**:

1. Choose Aliyun, Tencent, or dual-cloud upload.
2. Configure and test every enabled provider.
3. Add the data root that contains the `YYYY-MM-DD` directories.
4. Adjust task, per-task file, and global file concurrency.
5. Configure or disable the upload time window.
6. Return to the dashboard and trigger a scan.

## Common Commands

```bash
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
npm run preview
npm run build:linux
npm run build:win
npm run build:all
```

Build output is written to `dist/`. The current application version is `2.0.2`.

## Architecture

```mermaid
flowchart LR
  UI["React Renderer<br/>dashboard / settings / history"] --> IPC["Preload + IPC"]
  IPC --> Scanner["ScannerService<br/>date discovery / stability"]
  IPC --> Queue["TaskQueueService<br/>window / concurrency"]
  Queue --> Runner["TaskRunnerService<br/>filter / resume / retry"]
  Runner --> Cloud["CloudUploadService"]
  Cloud --> Aliyun["Aliyun OSS"]
  Cloud --> Tencent["Tencent TurboS3"]
  IPC --> Remote["SSHRsyncService<br/>rsync / SFTP"]
  IPC --> Annotation["Annotation Window"]
  Scanner --> DB[("SQLite")]
  Runner --> DB
  Scanner --> Marker["tmp_upload.json<br/>process_task.json<br/>day_upload.json"]
```

The dashboard and history pages expose separate Aliyun and Tencent views. SQLite stores
logical tasks plus per-provider task and file destinations, while marker files keep
recovery and operational state beside the collected data.

## Data and Logs

- Database: `uploader.db` under Electron's `userData` directory
- Logs: `userData/logs` by default
- Task markers:
  - `tmp_upload.json`: the welding directory has been registered
  - `process_task.json`: logical and per-provider upload state
  - `day_upload.json`: the past date directory is fully complete

See the [documentation index](docs/README.md) for architecture, configuration, workflows,
IPC contracts, storage details, and troubleshooting.

## License

This project is licensed under the [MIT License](LICENSE).
