// All process/shell dispatch is intercepted before any IPC. The .exe fixtures
// contain invented PE headers, never runnable game or operating-system binaries.
async function installLaunchStubs(electronApp) {
  return electronApp.evaluate(({ app, shell, dialog }) => {
    const fs = process.getBuiltinModule("node:fs"), path = process.getBuiltinModule("node:path");
    const { EventEmitter } = process.getBuiltinModule("node:events");
    const directory = path.join(app.getPath("userData"), "synthetic-games");
    fs.mkdirSync(directory, { recursive: true });
    const pe = Buffer.alloc(512);
    pe.write("MZ"); pe.writeUInt32LE(128, 60); pe.write("PE\0\0", 128);
    pe.writeUInt16LE(0x8664, 132); pe.writeUInt16LE(0x0002, 150);
    pe.writeUInt16LE(0x20b, 152);
    const selected = path.join(directory, "standalone game.exe");
    const arbitrary = path.join(directory, "Hero_Siege.exe");
    fs.writeFileSync(selected, pe); fs.writeFileSync(arbitrary, Buffer.concat([pe, Buffer.from("different binary")]));
    const calls = [];
    shell.openPath = async target => { calls.push({ kind: "openPath", target }); return ""; };
    shell.openExternal = async target => { calls.push({ kind: "openExternal", target }); };
    process.getBuiltinModule("node:child_process").spawn = (target, args, options) => {
      calls.push({ kind: "spawn", target, args, options });
      const child = new EventEmitter(); child.unref = () => {};
      queueMicrotask(() => child.emit("spawn")); return child;
    };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    global.__launchSecurity = { calls, selected, arbitrary };
    return { selected, arbitrary };
  });
}
module.exports = { installLaunchStubs };
