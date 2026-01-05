import { connect } from "datocms-plugin-sdk";
import "datocms-react-ui/styles.css";
import { render } from "./utils/render";
import { ZonedDateTimePicker } from "./components/ZonedDateTimePicker";
import { DebugModal } from "./components/DebugModal";

connect({
  /* Main component */

  // First we register the field extension with the plugin SDK
  manualFieldExtensions() {
    return [
      {
        id: "zonedDateTimePicker",
        name: "Zoned DateTime Picker",
        type: "editor",
        fieldTypes: ["json"],
        configurable: false,
        helpText:
          "Saves a JSON object with IXDTF and derived fields (zoned_datetime_ixdtf, datetime_iso8601, zone, offset, date, time_24hr, time_12hr, am_pm, timestamp_epoch_seconds)",
      },
    ];
  },

  // Then we tell it how to render it
  renderFieldExtension(fieldExtensionId, ctx) {
    if (fieldExtensionId === "zonedDateTimePicker") {
      return render(<ZonedDateTimePicker ctx={ctx} />); // <-- Main component is here!
    }
  },

  /* Debug utils */

  // We'll register a field context menu dropdown (to show a debugging modal)
  fieldDropdownActions(field) {
    if (field.attributes?.appearance?.field_extension === "zonedDateTime") {
      return [
        {
          id: "showDebug",
          label: "Show JSON value",
          icon: "code",
        },
      ];
    } else {
      return [];
    }
  },

  // Tell the plugin SDK what to run when that dropdown item is clicked on
  async executeFieldDropdownAction(actionId, ctx) {
    if (actionId === "showDebug") {
      ctx.openModal({
        id: "debugModal",
        title: `${ctx.fieldPath}`,
        width: "xl",
        parameters: { value: ctx.formValues[ctx.fieldPath] }, // Pass the JSON value to the modal
      });
    }
  },

  // Actually render the modal
  renderModal(modalId, ctx) {
    if (modalId === "debugModal") {
      render(<DebugModal ctx={ctx} />);
    }
  },
});
