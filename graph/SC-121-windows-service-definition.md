---
certainty: assumed
effort: 1
---

# SC-121: Windows service definition

The WinSW service wrapper and its configuration file, shipped in the Windows zip (SC-120), which register the tool as a Windows service that starts at boot, if the user chooses to ([DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md)). The configuration runs the zip's own Node.js runtime on the backend, from the zip's folder, and sends the backend Ctrl+C when the service is stopped, waiting for it to close before stopping it by force. It also covers the README's instructions for registering, starting, stopping and removing the service, and the wrapper's licence in the zip.

It is done when the service, registered from the unpacked zip and started, serves the tool, and stopped, logs that the backend closed on the interrupt before the process ended.

Origin: derived by Claude from [DD-061](DD-061-the-tool-also-ships-for-windows-as-a-portable-zip-.md) for issue #235. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
