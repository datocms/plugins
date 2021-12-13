import React, { Component } from 'preact-compat';
import PropTypes from 'prop-types';
import cn from 'classname';
import { connect } from 'react-redux';

import Client from './client';
import { fetchFormById } from './store';

@connect((state, props) => {
  const info = state.forms[props.value] || { status: 'loading', result: null };
  const form = info.result;

  return {
    status: info.status,
    form: form
      ? Object.assign({}, form, { theme: state.themes[form.theme.href] })
      : form,
    results: state.results[props.value],
  };
})

export default class Value extends Component {
  propTypes = {
    value: PropTypes.string.isRequired,
    status: PropTypes.string.isRequired,
    results: PropTypes.object,
    form: PropTypes.object,
    client: PropTypes.instanceOf(Client).isRequired,
    onReset: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
  }

  componentDidMount() {
    const { value } = this.props;
    this.findForm(value);
  }

  componentWillReceiveProps(nextProps) {
    const { value } = this.props;

    if (nextProps.value !== value && nextProps.value) {
      this.findForm(nextProps.value);
    }
  }

  findForm(id) {
    const { client, dispatch } = this.props;
    dispatch(fetchFormById(id, client));
  }

  renderForm() {
    const { form, results } = this.props;

    let backgroundImage = null;

    if (form.theme && form.theme.background) {
      backgroundImage = form.theme.background.href;
    } else if (
      form.welcome_screens
      && form.welcome_screens.length > 0
      && form.welcome_screens[0].attachment
    ) {
      backgroundImage = form.welcome_screens[0].attachment.href;
    }

    return (
      <div className="value__form">
        <div
          className="value__form__image"
          style={{
            backgroundImage: backgroundImage && `url(${backgroundImage})`,
            backgroundColor: form.theme && form.theme.colors.background,
          }}
        />
        <div className="value__form__info">
          <div className="value__form__title">
            <a
              href={form._links.display}
              target="_blank"
              rel="noopener noreferrer"
            >
              {form.title}
            </a>
          </div>
          <div className="value__form__description">
            {
              form.welcome_screens && form.welcome_screens.length > 0
                && (
                  <p>{form.welcome_screens[0].title}</p>
                )
            }
          </div>
          {
            form.fields
            && (
              <div className="value__form__form-info">
                <strong>Fields:</strong>
                &nbsp;
                {form.fields.length}
                &nbsp;
                <span>fields</span>
              </div>
            )
          }
          {
            results
            && (
              <a
                href={`https://admin.typeform.com/form/${form.id}/results`}
                target="_blank"
                rel="noopener noreferrer"
                className="value__form__form-info"
              >
                <strong>Responses:</strong>
                &nbsp;
                {results.total_items}
                &nbsp;
                <span>responses</span>
              </a>
            )
          }
        </div>
      </div>
    );
  }

  render() {
    const { onReset, form, status } = this.props;

    return (
      <div className={cn('value', { loading: status === 'loading' })}>
        {form && this.renderForm()}
        <button type="button" className="value__reset" onClick={onReset} />
      </div>
    );
  }
}
