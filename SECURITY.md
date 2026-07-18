# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/okturan/tinyvoice/security/advisories/new). Do not publish a working exploit, private room name, audio sample, or user identifier in an issue.

Include the affected commit or deployed route, browser and operating system, and a minimal reproduction. Synthetic codec packets and temporary room names are preferred. A useful report explains the trust boundary it crosses, for example:

- room or Durable Object isolation;
- malformed control frames or codec packets reaching peers;
- script injection through room names, display names, URLs, or QR input;
- model-manifest, download, or IndexedDB integrity checks being bypassed;
- unintended retention or disclosure by the Worker or lobby;
- denial of service that bypasses the documented packet, name, room, or connection bounds.

TinyVoice's public rooms are intentionally unauthenticated, listed by `/rooms`, and not end-to-end encrypted. Anyone with a valid room identifier can join. Those documented product limits are not vulnerabilities by themselves. Problems in FocalCodec, model files, ONNX Runtime, browsers, or Cloudflare should go to the upstream project unless TinyVoice's integration creates the issue.

The current default branch and public deployment are supported. I will investigate private reports and coordinate disclosure after a fix or clear mitigation is available. No response-time or remediation-time guarantee is implied.

## Safe testing

Use synthetic audio or codec packets. Do not record another person, join rooms you do not control, send high-volume traffic, or test against other users without permission. A local Worker and disposable room are the preferred reproduction environment.
