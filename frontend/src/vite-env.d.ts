/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

declare const process: {
  env: {
    VITE_API_URL?: string;
  };
};
