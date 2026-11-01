/*
 * HTML Billiards v0.8.9 network configuration
 *
 * 用 server/lan-server.js 托管时, 服务器会在这个文件末尾自动追加局域网配置
 * (signalingUrl 改为本机服务, lanMode: true), 这里无需改动。
 *
 * Toy is a static frontend host. For Bilibili Toy room-code invitations, deploy the
 * Cloudflare Pages signaling backend, then paste its
 * HTTPS endpoint below.
 *
 * Example:
 * signalingUrl: "https://8balls-signal.pages.dev"
 */
window.BILLIARDS_NETWORK_CONFIG = {
  signalingUrl: "https://8balls-signal.pages.dev",
  toyPublicUrl: "https://www.bilibili.com/toy/8Balls/index.html",

  // STUN helps WebRTC find a direct route across different networks.
  // For same-LAN play, host candidates are normally enough.
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: "stun:stun.l.google.com:19302" }
  ],

  // Keep true so an invite created with a manually entered signal URL also
  // carries that endpoint in the URL fragment for the invited friend.
  includeSignalInInvite: true
};
