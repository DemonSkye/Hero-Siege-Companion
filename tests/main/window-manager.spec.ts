import { describe, expect, test, vi } from "vitest";
import { MainWindowManager } from "../../src/main/window-manager";
import type { WindowBoundsPreferences } from "../../src/main/persistence";

const electronMock = vi.hoisted(() => {
  const instances: FakeBrowserWindow[] = [];

  class FakeWebContents {
    id = 1;

    setWindowOpenHandler() {
      return undefined;
    }

    on() {
      return undefined;
    }

    send() {
      return undefined;
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
    bounds: Electron.Rectangle;

    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      this.bounds = { x: 0, y: 0, width: Number(options.width), height: Number(options.height) };
    }

    on() {
      return undefined;
    }

    loadFile() {
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

    setMinimumSize() {
      return undefined;
    }

    setMaximizable() {
      return undefined;
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
      return undefined;
    }

    moveTop() {
      return undefined;
    }

    focus() {
      return undefined;
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
    shell: { openExternal: () => Promise.resolve() },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  nativeImage: electronMock.nativeImage,
  shell: electronMock.shell,
}));

function createManager(windowBounds: WindowBoundsPreferences = {}) {
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
  });
}

describe("main window manager", () => {
  test("runs preload outside the Electron sandbox so shared IPC modules resolve after packaging", () => {
    electronMock.instances.length = 0;

    createManager().create();

    expect(electronMock.instances[0]?.options.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    });
  });
});
