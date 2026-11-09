/**
 * Start and stop hooks. The container (src/container.ts) calls them on every service that has them:
 * onModuleInit (connect, load settings), then onApplicationBootstrap (start workers) when the app
 * starts, and onModuleDestroy when it stops.
 */
export interface OnModuleInit {
  onModuleInit(): unknown;
}

export interface OnApplicationBootstrap {
  onApplicationBootstrap(): unknown;
}

export interface OnModuleDestroy {
  onModuleDestroy(): unknown;
}
