import React, { Component } from 'react';
import PropTypes from 'prop-types';

import connectToDatoCms from './connectToDatoCms';
import fetchUser from './fetchUser';
import colorFor from './colorFor';
import titleize from './titleize';

import './style.sass';

@connectToDatoCms(plugin => ({
  userId: plugin.getFieldValue(plugin.fieldPath),
  config: plugin.parameters.global,
}))

export default class Main extends Component {
  static propTypes = {
    userId: PropTypes.string,
    config: PropTypes.object.isRequired,
  }

  constructor(props) {
    super(props);
    this.state = {
      user: null,
      status: props.userId ? 'loading' : 'success',
    };
  }

  componentDidMount() {
    const { userId, config } = this.props;

    if (userId) {
      fetchUser(userId, config)
        .then(newState => this.setState(newState));
    }
  }

  renderUser() {
    const { user } = this.state;

    const fullName = user.user_metadata && user.user_metadata.full_name;
    const initial = (fullName || user.email)[0];
    const backgroundColor = colorFor(fullName || user.email);

    return (
      <div className="info">
        <div className="info__avatar">
          <div className="avatar" style={{ backgroundColor }}>
            {initial}
          </div>
        </div>
        <div className="info__details">
          {
            fullName
              ? (
                <div className="info__name">
                  {fullName}
                </div>
              ) : (
                <div className="info__no-name">
                  No name provided
                </div>
              )
          }
          <div className="info__email">
            {user.email}
          </div>
          <table>
            {
              Object.entries(user.user_metadata || {})
                .map(([key, value]) => (
                  <tr key={key}>
                    <th>{titleize(key)}</th>
                    <td>{value}</td>
                  </tr>
                ))
            }
          </table>
        </div>
      </div>
    );
  }

  renderLoading() {
    return <span>Loading</span>;
  }

  renderEmpty() {
    return <span>Empty</span>;
  }

  renderNotFound() {
    return <span>Not found</span>;
  }

  renderError() {
    return <span>Error</span>;
  }

  render() {
    const { userId } = this.props;
    const { status } = this.state;

    if (!userId) {
      return this.renderEmpty();
    }

    if (status === 'notFound') {
      return this.renderNotFound();
    }

    if (status === 'error') {
      return this.renderError();
    }

    if (status === 'loading') {
      return this.renderLoading();
    }

    return this.renderUser();
  }
}
