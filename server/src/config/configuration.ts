export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  auth: {
    password: process.env.PBG_AUTH_PASSWORD ?? '',
  },
  session: {
    secret: process.env.PBG_SESSION_SECRET ?? 'dev-insecure-secret',
  },
  backupDir: process.env.PBG_BACKUP_DIR ?? '/app/backups',
});
