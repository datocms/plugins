import React, { Component } from 'preact-compat';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import cn from 'classname';

import Client from './client';
import { fetchFormsMatching } from './store';

@connect((state) => {
  const search = state.searches[state.query] || { status: 'loading', result: [] };

  return {
    query: state.query,
    status: search.status,
    forms: search.result.map((id) => {
      const form = state.forms[id].result;

      return form
        ? Object.assign({}, form, { theme: state.themes[form.theme.href] })
        : form;
    }),
  };
})

export default class Empty extends Component {
  propTypes = {
    client: PropTypes.instanceOf(Client).isRequired,
    onSelect: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    status: PropTypes.string.isRequired,
    forms: PropTypes.array,
  }

  componentDidMount() {
    this.performSearch();
  }

  performSearch(query) {
    const { client, dispatch } = this.props;
    dispatch(fetchFormsMatching(query, client));
  }

  handleSubmit(e) {
    e.preventDefault();
    this.performSearch(this.el.value);
  }

  handleSelect(form, e) {
    const { onSelect } = this.props;
    e.preventDefault();

    onSelect(form);
  }

  renderResult(form) {
    return (
      <button
        className="empty__form"
        type="button"
        key={form.handle}
        onClick={this.handleSelect.bind(this, form)}
      >
        <div
          className="empty__form__bg"
          style={{
            backgroundImage: form.theme && form.theme.background && `url(${form.theme.background.href})`,
            backgroundColor: form.theme && form.theme.colors.background,
          }}
        >
          <div
            className="empty__form__title"
            style={{ color: form.theme && form.theme.colors.question }}
          >
            {form.title}
          </div>
        </div>
      </button>
    );
  }

  render() {
    const { forms, status } = this.props;

    return (
      <div className="empty">
        <div className="empty__label">
          No Typeform selected
        </div>
        <form className="empty__search" onSubmit={this.handleSubmit.bind(this)}>
          <div className="empty__search__input">
            <input
              placeholder="Search typeforms by name..."
              type="text"
              ref={(el) => { this.el = el; }}
            />
          </div>
          <button
            className={cn('DatoCMS-button--primary', { loading: status === 'loading' })}
            type="submit"
          >
            Search
            <span className="spinner" />
          </button>
        </form>
        {
          forms
            && (
              <div className={cn('empty__forms', { loading: status === 'loading' })}>
                {forms.map(this.renderResult, this)}
              </div>
            )
        }
      </div>
    );
  }
}
