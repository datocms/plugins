import { connect } from 'datocms-plugin-sdk';
import Canvas from 'datocms-react-ui/Canvas';
import { DebugModal } from './components/DebugModal';
import { ZonedDateTimePicker } from './components/ZonedDateTimePicker';
import { render } from './utils/render';
import 'datocms-react-ui/styles.css';
import './frame.css';

connect({
  manualFieldExtensions() {
    return [
      {
        id: 'zonedDateTimePicker',
        name: 'Zoned datetime picker',
        type: 'editor',
        fieldTypes: ['json'],
        configurable: false,
        helpText:
          'Saves a JSON object with an IXDTF string and derived fields: zonedDateTime, dateTime, zone, offset, date, time_24hr, time_12hr, ampm and timestamp.',
      },
    ];
  },

  renderFieldExtension(_, ctx) {
    render(
      <Canvas ctx={ctx}>
        <ZonedDateTimePicker ctx={ctx} />
      </Canvas>,
    );
  },

  // A field menu action that opens a modal with the field's raw JSON value
  fieldDropdownActions() {
    return [
      {
        id: 'showDebug',
        label: 'Show JSON value',
        icon: 'code',
      },
    ];
  },

  async executeFieldDropdownAction(actionId, ctx) {
    if (actionId === 'showDebug') {
      await ctx.openModal({
        id: 'debugModal',
        title: `JSON value of “${ctx.field.attributes.label}”`,
        width: 'xl',
        parameters: { value: ctx.formValues[ctx.fieldPath] },
      });
    }
  },

  renderModal(modalId, ctx) {
    if (modalId === 'debugModal') {
      render(
        <Canvas ctx={ctx}>
          <DebugModal ctx={ctx} />
        </Canvas>,
      );
    }
  },
});
