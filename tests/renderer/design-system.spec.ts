import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { describe, expect, test } from "vitest";
import DialogShell from "../../src/renderer/src/components/DialogShell.vue";
import SettingsActionDialog from "../../src/renderer/src/components/SettingsActionDialog.vue";
import ViewTabs from "../../src/renderer/src/components/ViewTabs.vue";

describe("keyboard navigation and dialog contracts", () => {
  test("tabs use one stop, wrap arrows, support Home/End, and move focus with selection", async () => {
    const wrapper = mount({
      components: { ViewTabs },
      setup: () => ({ active: ref("live") }),
      template: '<ViewTabs v-model="active" />',
    }, { attachTo: document.body });
    try {
      const live = wrapper.get("#view-tab-live");
      const filter = wrapper.get("#view-tab-filter");
      const past = wrapper.get("#view-tab-past");
      live.element.focus();
      await live.trigger("keydown", { key: "ArrowRight" });
      await nextTick();
      expect(document.activeElement).toBe(filter.element);
      expect(filter.attributes("aria-selected")).toBe("true");
      expect(wrapper.findAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
      expect(filter.attributes("aria-controls")).toBe("view-panel-filter");
      await filter.trigger("keydown", { key: "End" });
      expect(document.activeElement).toBe(past.element);
      await past.trigger("keydown", { key: "ArrowRight" });
      expect(document.activeElement).toBe(live.element);
      await live.trigger("keydown", { key: "ArrowLeft" });
      expect(document.activeElement).toBe(past.element);
      await past.trigger("keydown", { key: "Home" });
      expect(document.activeElement).toBe(live.element);
      await live.trigger("keydown", { key: "ArrowRight", ctrlKey: true });
      expect(document.activeElement).toBe(live.element);
    } finally { wrapper.unmount(); }
  });

  test("modal Tab includes native summary and excludes closed details, hidden ancestors, and disabled fieldsets", async () => {
    const wrapper = mount(DialogShell, {
      attachTo: document.body,
      props: { labelledBy: "focus-dialog-title" },
      slots: { default: `
        <h2 id="focus-dialog-title">Readiness</h2>
        <details><summary>Connection readiness</summary><button class="detail-action">Inside details</button></details>
        <fieldset disabled><button>Disabled fieldset</button></fieldset>
        <div hidden><button>Hidden</button></div>
        <div style="display:none"><button>Hidden by style</button></div>
        <div inert><button>Inert</button></div>
      ` },
    });
    try {
      await nextTick();
      const dialog = wrapper.get('[role="dialog"]');
      const summary = wrapper.get("summary");
      await dialog.trigger("keydown", { key: "Tab" });
      expect(document.activeElement).toBe(summary.element);
      await summary.trigger("keydown", { key: "Tab" });
      expect(document.activeElement).toBe(summary.element);
      await summary.trigger("keydown", { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(summary.element);
      wrapper.get("details").element.setAttribute("open", "");
      wrapper.get(".detail-action").element.focus();
      await wrapper.get(".detail-action").trigger("keydown", { key: "Tab" });
      expect(document.activeElement).toBe(summary.element);
      await summary.trigger("keydown", { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(wrapper.get(".detail-action").element);
    } finally { wrapper.unmount(); }
  });

  test("a busy confirmation cannot dismiss through Escape, backdrop, or close controls; focus restores", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(SettingsActionDialog, {
      attachTo: document.body,
      props: { title: "Apply configuration", busy: false },
    });
    try {
      await nextTick();
      expect(document.activeElement).toBe(wrapper.get(".settings-close").element);
      await wrapper.setProps({ busy: true });
      await wrapper.get(".settings-action-backdrop").trigger("click");
      await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
      await wrapper.get(".settings-close").trigger("click");
      expect(wrapper.emitted("close")).toBeUndefined();
      expect(wrapper.get('[role="dialog"]').attributes("aria-busy")).toBe("true");
      expect(wrapper.findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
      await wrapper.setProps({ busy: false });
      await wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("close")).toHaveLength(1);
    } finally {
      wrapper.unmount();
      expect(document.activeElement).toBe(opener);
      opener.remove();
    }
  });
});
