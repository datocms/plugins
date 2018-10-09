import React from 'react';
import { render } from 'react-dom';
import Note from './Note.jsx';

import './style.sass';

function deserialize(plugin) {
  const fieldValue = plugin.getFieldValue(plugin.fieldPath);

  if (!fieldValue) {
    if (plugin.parameters.instance.initialNote) {
      return [
        {
          comment: plugin.parameters.instance.initialNote,
          timestamp: (new Date()).toISOString(),
        },
      ];
    }

    return [];
  }

  return JSON.parse(fieldValue);
}

function serialize(notes) {
  return JSON.stringify(notes);
}

window.DatoCmsPlugin.init().then((plugin) => {
  plugin.startAutoResizer();

  class App extends React.Component {
    constructor(props) {
      super(props);
      this.state = {
        notes: deserialize(plugin),
      };
    }

    componentDidMount() {
      this.unsubscribe = plugin.addFieldChangeListener(plugin.fieldPath, () => {
        this.setState({ notes: deserialize(plugin) });
      });
    }

    componentWillUnmount() {
      this.unsubscribe();
    }

    handleAddNote(e) {
      const { notes } = this.state;

      e.preventDefault();

      plugin.setFieldValue(
        plugin.fieldPath,
        serialize(notes.concat({
          comment: '',
          timestamp: (new Date()).toISOString(),
        })),
      );
    }

    handleEdit(index, comment) {
      const { notes } = this.state;

      plugin.setFieldValue(
        plugin.fieldPath,
        serialize(Object.assign(
          [], notes,
          {
            [index]: Object.assign({}, notes[index], { comment }),
          },
        )),
      );
    }

    handleDelete(index) {
      const { notes } = this.state;

      plugin.setFieldValue(
        plugin.fieldPath,
        serialize(notes.filter((note, i) => i !== index)),
      );
    }

    renderNote(note, i) {
      return (
        <Note
          key={note.timestamp}
          note={note}
          onEdit={this.handleEdit.bind(this, i)}
          onDelete={this.handleDelete.bind(this, i)}
        />
      );
    }

    render() {
      const { notes } = this.state;

      return (
        <div className="notes">
          {notes.map(this.renderNote.bind(this))}
          <button
            type="button"
            className="notes__add"
            onClick={this.handleAddNote.bind(this)}
          >
            Add a new note...
          </button>
        </div>
      );
    }
  }

  render(<App />, document.body);
});
