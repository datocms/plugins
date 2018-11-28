import React, { Component } from 'react';
import PropTypes from 'prop-types';

import colorFor from './colorFor';
import titleize from './titleize';

import circleUp from './circle-up.svg';
import circleDown from './circle-down.svg';

import AutoUpdateTime from './AutoUpdateTime';

export default class UserInfo extends Component {
  static propTypes = {
    user: PropTypes.object.isRequired,
  }

  state = {
    isOpen: false,
  }

  handleToggle = () => {
    this.setState(state => ({ isOpen: !state.isOpen }));
  }

  render() {
    const { user } = this.props;
    const { isOpen } = this.state;

    const fullName = user.user_metadata && user.user_metadata.full_name;
    const initial = (fullName || user.email)[0];
    const backgroundColor = colorFor(fullName || user.email);
    const roles = user.app_metadata && user.app_metadata.roles;

    return (
      <div className="container">
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
          </div>
          <button type="button" className="info__button" onClick={this.handleToggle}>
            <span>
              {isOpen ? 'Close details' : 'Show more details'}
            </span>
            <img src={isOpen ? circleUp : circleDown} alt="toggle" />
          </button>
        </div>
        {
          isOpen
          && (
            <div className="details">
              <div className="details__pane">
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
              <div className="details__pane">
                <table>
                  {
                    roles
                    && (
                      <tr>
                        <th>Roles</th>
                        <td>
                          {
                            roles.length > 0
                              ? roles.map(titleize).join(', ')
                              : 'No roles set'
                          }
                        </td>
                      </tr>
                    )
                  }
                  {
                    ['created_at', 'updated_at', 'confirmed_at', 'confirmation_sent_at'].map(attr => (
                      <tr key={attr}>
                        <th>{titleize(attr.replace('_at', ''))}</th>
                        <td><AutoUpdateTime value={user[attr]} /></td>
                      </tr>
                    ))
                  }
                </table>
              </div>
            </div>
          )
        }
      </div>
    );
  }
}
