// Unlike index.ts, serverless requests must not start listeners or timer workers.
// Scheduled work is awaited by the protected maintenance route instead.
export { default } from "./app";
