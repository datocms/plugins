import React, { Component } from 'react';
import PropTypes from 'prop-types';

import connectToDatoCms from './connectToDatoCms';
import fetchUser from './fetchUser';

import UserInfo from './UserInfo';

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

    return (
      <UserInfo user={user} />
    );
  }

  renderLoading() {
    const { userId } = this.props;

    return (
      <div className="container">
        <div className="info">
          <div className="info__avatar">
            <div className="avatar avatar--loading" />
          </div>
          <div className="info__details">
            <div className="info__no-name">
              Loading user info...
            </div>
            <div className="info__email">
              {userId}
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderEmpty() {
    return <span>Empty</span>;
  }

  renderNotFound() {
    const { userId } = this.props;

    return (
      <div className="container">
        <div className="info">
          <div className="info__avatar">
            <div className="avatar avatar--loading" />
          </div>
          <div className="info__details">
            <div className="info__no-name">
              User not found!
            </div>
            <div className="info__submessage">
              {userId}
            </div>
          </div>
        </div>
      </div>
    );
  }

  renderError() {
    const { error, details } = this.state;

    return (
      <div className="container">
        <div className="info">
          <div className="info__avatar">
            <div className="avatar avatar--loading" />
          </div>
          <div className="info__details">
            <div className="info__no-name">
              {error}
            </div>
            {
              details
                && (
                  <div className="info__submessage">
                    {details}
                  </div>
                )
            }
          </div>
        </div>
      </div>
    );
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
