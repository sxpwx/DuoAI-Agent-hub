# Third-party notices / 第三方声明

The COSY protocol implementation (device sign-in flow, request signing, body
codec and SSE parsing) in `src/agents/qwenwork-chat.ts` and
`src/agents/qwenwork-auth.ts` is ported from the MIT-licensed community project
[@magpie-community/opencode-qoder-auth](https://github.com/magpie-community/plugins),
which itself derives from [CLIProxyAPI](https://github.com/ufec/CLIProxyAPI) (MIT).
Original copyright notices of those projects apply to the ported portions.
Reference copies are kept under `vendor/qwenwork-auth/` with their licenses.

千问办公 / Qoder CN 的 COSY 协议实现（设备流登录、请求签名、请求体编解码、SSE 解析）
移植自 MIT 许可的社区项目 @magpie-community/opencode-qoder-auth（其本身源自 MIT 的
CLIProxyAPI）。被移植部分保留原项目版权声明；参考副本见 vendor/qwenwork-auth/。