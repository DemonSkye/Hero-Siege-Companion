import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MainWindowManager } from "../../src/main/window-manager";
import type { WindowBoundsPreferences } from "../../src/main/persistence";

const electronMock = vi.hoisted(() => {
  const instances: FakeBrowserWindow[] = [];

  class FakeWebContents {
    id = 1;
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
    loadFileCalls = 0;

    setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
      this.windowOpenHandler = handler;
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    openWindow(url: string) {
      if (!this.windowOpenHandler) throw new Error("window open handler was not registered");
      return this.windowOpenHandler({ url });
    }

    getURL() {
      return "file:///renderer/index.html";
    }
  }

  class FakeBrowserWindow {
    static nextId = 1;

    id = FakeBrowserWindow.nextId++;
    webContents = new FakeWebContents();
    destroyed = false;
    minimized = false;
    maximized = false;
    alwaysOnTop = false;
    maximizable = true;
    minimumSize: [number, number] | null = null;
    showCalls = 0;
    moveTopCalls = 0;
    focusCalls = 0;
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    bounds: Electron.Rectangle;

    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      this.bounds = { x: 0, y: 0, width: Number(options.width), height: Number(options.height) };
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }

    loadFile() {
      this.webContents.loadFileCalls += 1;
      return Promise.resolve();
    }

    getBounds() {
      return this.bounds;
    }

    setBounds(bounds: Electron.Rectangle) {
      this.bounds = { ...bounds };
    }

    setSize(width: number, height: number) {
      this.bounds = { ...this.bounds, width, height };
    }

    setMinimumSize(width: number, height: number) {
      this.minimumSize = [width, height];
    }

    setMaximizable(enabled: boolean) {
      this.maximizable = enabled;
    }

    isMaximized() {
      return this.maximized;
    }

    maximize() {
      this.maximized = true;
    }

    unmaximize() {
      this.maximized = false;
    }

    minimize() {
      this.minimized = true;
    }

    isMinimized() {
      return this.minimized;
    }

    restore() {
      this.minimized = false;
    }

    isDestroyed() {
      return this.destroyed;
    }

    close() {
      this.destroyed = true;
    }

    setAlwaysOnTop(enabled: boolean) {
      this.alwaysOnTop = enabled;
    }

    isAlwaysOnTop() {
      return this.alwaysOnTop;
    }

    show() {
      this.showCalls += 1;
    }

    moveTop() {
      this.moveTopCalls += 1;
    }

    focus() {
      this.focusCalls += 1;
    }
  }

  function BrowserWindow(options: Electron.BrowserWindowConstructorOptions) {
    const window = new FakeBrowserWindow(options);
    instances.push(window);
    return window;
  }

  return {
    instances,
    BrowserWindow,
    nativeImage: { createFromPath: () => ({}) },
    shell: { openExternal: vi.fn(() => Promise.resolve()) },
  };
});

const persistenceMock = vi.hoisted(() => ({
  saveWindowBounds: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  nativeImage: electronMock.nativeImage,
  shell: electronMock.shell,
}));

vi.mock("../../src/main/persistence", () => ({
  saveWindowBounds: persistenceMock.saveWindowBounds,
  withMinimumBounds: (
    bounds: Electron.Rectangle | undefined,
    minimums: { width: number; height: number; minWidth: number; minHeight: number },
  ) => {
    if (!bounds) return undefined;
    return {
      ...bounds,
      width: Math.max(bounds.width, minimums.minWidth),
      height: Math.max(bounds.height, minimums.minHeight),
    };
  },
}));

function createManager(windowBounds: WindowBoundsPreferences = {}, overrides: Partial<ConstructorParameters<typeof MainWindowManager>[0]> = {}) {
  return new MainWindowManager({
    preloadPath: "dist/main/main/preload.js",
    rendererIndexPath: "dist/renderer/index.html",
    iconPath: "icon.ico",
    windowBoundsPath: "window-bounds.json",
    windowBounds,
    writeAppLog: vi.fn(),
    addLog: vi.fn(),
    publishStateNow: vi.fn(),
    getCaptureSnapshot: () => ({ captureStatus: "idle", captureRunning: false }),
    ...overrides,
  });
}

describe("main window manager", () => {
  beforeEach(() => {
    electronMock.instances.length = 0;
    electronMock.shell.openExternal.mockClear();
    persistenceMock.saveWindowBounds.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("runs preload outside the Electron sandbox so shared IPC modules resolve after packaging", () => {
    createManager().create();

    expect(electronMock.instances[0]?.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    });
  });

  test("denies renderer-created windows and only opens external http links through the shell", () => {
    createManager().create();
    const window = electronMock.instances[0];

    expect(window.webContents.openWindow("https://example.com/release")).toEqual({ action: "deny" });
    expect(electronMock.shell.openExternal).toHaveBeenCalledWith("https://example.com/release");

    electronMock.shell.openExternal.mockClear();
    expect(window.webContents.openWindow("file:///C:/Users/example/AppData/local.txt")).toEqual({ action: "deny" });
    expect(window.webContents.openWindow("javascript:alert(1)")).toEqual({ action: "deny" });
    expect(electronMock.shell.openExternal).not.toHaveBeenCalled();
  });

  test("saves the current mode bounds before restoring locked compact and normal positions", () => {
    const savedBounds: WindowBoundsPreferences = {
      compact: { x: 40, y: 50, width: 500, height: 240 },
      normal: { x: 10, y: 20, width: 1300, height: 820 },
    };
    const manager = createManager(savedBounds);
    const window = manager.create();
    window.setBounds({ x: 1, y: 2, width: 1188, height: 766 });

    manager.setCompactMode(true, true);

    expect(manager.isCompactMode).toBe(true);
    expect(savedBounds.normal).toEqual({ x: 1, y: 2, width: 1188, height: 766 });
    expect(window.getBounds()).toEqual({ x: 40, y: 50, width: 500, height: 240 });
    expect(window.maximizable).toBe(false);
    expect(window.minimumSize).toEqual([340, 160]);
    expect(persistenceMock.saveWindowBounds).toHaveBeenCalledWith("window-bounds.json", savedBounds, expect.any(Function));

    manager.setCompactMode(false, true);

    expect(manager.isCompactMode).toBe(false);
    expect(savedBounds.compact).toEqual({ x: 40, y: 50, width: 500, height: 240 });
    expect(window.getBounds()).toEqual({ x: 1, y: 2, width: 1188, height: 766 });
    expect(window.maximizable).toBe(true);
    expect(window.minimumSize).toEqual([980, 620]);
  });

  test("debounces moved and resized window bounds persistence", () => {
    vi.useFakeTimers();
    const savedBounds: WindowBoundsPreferences = {};
    const manager = createManager(savedBounds);
    const window = manager.create();

    window.setBounds({ x: 11, y: 22, width: 1200, height: 700 });
    window.emit("moved");
    window.setBounds({ x: 33, y: 44, width: 1250, height: 720 });
    window.emit("resized");

    vi.advanceTimersByTime(249);
    expect(persistenceMock.saveWindowBounds).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(savedBounds.normal).toEqual({ x: 33, y: 44, width: 1250, height: 720 });
    expect(persistenceMock.saveWindowBounds).toHaveBeenCalledTimes(1);
  });

  test("recovers the renderer after crash reasons but not clean or killed exits", () => {
    vi.useFakeTimers();
    const publishStateNow = vi.fn();
    const addLog = vi.fn();
    const writeAppLog = vi.fn();
    const manager = createManager({}, { publishStateNow, addLog, writeAppLog });
    const window = manager.create();

    window.webContents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
    window.webContents.emit("render-process-gone", {}, { reason: "killed", exitCode: 0 });
    vi.runOnlyPendingTimers();
    expect(window.webContents.loadFileCalls).toBe(1);

    window.webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });
    expect(writeAppLog).toHaveBeenCalledWith("renderer-recovery-scheduled", { reason: "crashed", rendererRecoveriesInWindow: 1 });

    vi.advanceTimersByTime(500);

    expect(window.webContents.loadFileCalls).toBe(2);
    expect(publishStateNow).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith("warning", "Recovered the app window after a renderer crash.");
  });
});
