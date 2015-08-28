/*
Copyright (c) 2015 Unify Inc. All rights reserved.
*/

(function(document) {
  'use strict';

  var NUMBER_INITIAL_CONVERSATIONS = 80;
  var MAX_PRESENCE_SUBSCRIPTIONS = 100;
  var MAX_USERS_PER_REQUEST = 200;

  var api = new Circuit.Client({domain: 'circuitsandbox.net'});

  // Reference to our app
  var app = document.querySelector('#app');
  var api, cacheApi;

  app.addEventListener('dom-change', function() {
    console.log('DOM is ready');

    app.api = api;
    cacheApi = app.$.cache;       // Reference to Cache API
  });

  window.addEventListener('WebComponentsReady', function() {
    console.log('WebComponentsReady raised');

    api.addEventListener('registrationStateChanged', function (evt) {
      console.log('[APP] registrationState changed to ' + evt.state);
    });
  });
  
  // Favorites handling
  app.favorites = [];
  app.favoriteConversations = [];
  app.initializeDefaultFavorites = function() {
    app.favorites = [];
  }

  app.updateFavorite = function(convId) {
    var conv = app.cache.conversations.find(function (c) {
      return c.convId === convId;
    });
    if (conv.favorite) {
      app.push('favorites', convId);
    } else {
      var index = app.favorites.indexOf(convId);
      if (index > -1) {
          app.splice('favorites', index, 1);
      }
    }
    loadFavorites();
  }
  // End Favorties

  app.computeListWidth = function(isMobile) {
    // when in mobile screen size, make the list be 100% width to cover the whole screen
    return isMobile ? '100%' : '33%';
  }

  app.listTap = function() {
    this.$.mainDrawerPanel.closeDrawer();
  }

  app.newConversation = function () {
    app.$.router.go('/new');
  }

  app.showToast = showToast;

  app.conversationCompare = function (a, b) {
    var itemA = a.draftMessage || a.topLevelItem;
    itemA = Math.max((itemA && itemA.modificationTime) || a.modificationTime, a.lastCallTime || 0, a.draftMessageSendingTime || 0);
    var itemB = b.draftMessage || b.topLevelItem;
    itemB = Math.max((itemB && itemB.modificationTime) || b.modificationTime, b.lastCallTime || 0, b.draftMessageSendingTime || 0);
    return (itemB || 0) - (itemA || 0);
  }

  // ======================================
  // Private functions
  // ======================================

  function init() {
    app.selectedTab = 0;

    api.logon('roger.urscheler@unify.com', 'Ansible.2014')
      .then(function (user) {
        app.set('cache.localUser', user);
        showToast('Logged on as ' + app.cache.localUser.displayName);
      })
      .then(getSpecialConversationIds)
      .then(getConversations)
      .then(getUsersForConversations)
      .then(subscribePresence)
      .then(selectFirstConversation)
      .then(loadFavorites);

    setupEventListeners();    
  }

  function showToast(text) {
    var toast = document.querySelector('#logonToast');
    toast.text =text;
    toast.show();
  }

  function loadFavorites() {
    var favs = app.cache.conversations.filter(function (c) {
      return app.favorites.indexOf(c.convId) !== -1; 
    }).sort(function (a, b) {
      return a.topic.toLowerCase().localeCompare(b.topic.toLowerCase());
    });
    favs.forEach(function (c) {
      c.favorite = true;
    });
    app.set('favoriteConversations', favs);
  }

  function getSpecialConversationIds() {
    return new Promise(function (resolve, reject) {
      Promise.all([api.getTelephonyConversationId(), api.getSupportConversationId()]).then(function(convIds) {
        resolve(convIds);
      }, function(err) {
        reject(err);
      });
    });  
  }

  function getConversations(exclude) {
    return new Promise(function (resolve, reject) {
      api.getConversations({numberOfConversations: NUMBER_INITIAL_CONVERSATIONS, direction: 'BEFORE'}).then(function (conversations) {
        conversations = conversations.reverse();

        if (exclude) {
          // Exclude special conversations
          conversations = conversations.filter(function (c) {
            return exclude.indexOf(c.convId) === -1;
          });
        }

        app.set('cache.conversations', conversations);
        resolve(conversations);
      }, function(err) {
        reject(err);
      });
    });
  }

  function getUsersForConversations(conversations) {
    return new Promise(function (resolve, reject) {
      var userIds = getUserIdsForConversations(conversations).slice(0, MAX_USERS_PER_REQUEST);
      api.getUsersById(userIds).then(function (users) {
        // Filter out non-registered users an CMP users
        users = users.filter(function (u) {
          return !(u.firstName.startsWith('__UnDeF') || u.firstName.startsWith('_cmp_'));
        });
        app.set('cache.users', users);
        resolve(users);
      }, function(err) {
        reject(err);
      });
    });
  }

  function selectFirstConversation() {
    var conv = app.cache.conversations.find(function (c) {
      return c.type === 'GROUP';
    });
    if (conv) {
      app.$.groupList.selectConversation(conv.convId);
    }
  }

  function getUserIdsForConversations(conversations) {
    var userIds = [];
    conversations.forEach(function (c) {
      c.participants.forEach(function (p) {
        if (userIds.indexOf(p) === -1) {
          userIds.push(p);
        }
      });
    });
    return userIds;
  }

  function subscribePresence(users) {
    // Only subscribe to first 100 users for this demo. Not sure what
    // the limit is on the server, but we don't want to bring it down :)
    api.subscribePresence(users.map(function (u) {
      return u.userId;
    }).slice(0, MAX_PRESENCE_SUBSCRIPTIONS));
  }


  // ======================================
  // Injectors
  // ======================================

  Circuit.Injectors.conversationInjector = function (conversation) {
    return new Promise(function (resolve, reject) {
      try {
        // Get user objects for participant userIds other than mine,
        // then set the 'otherUsers', 'creator' and 'topLevelItem.creator'
        // attributes. Then also set the 'title' attribute.
        var userIds = conversation.participants.filter(function (p) {
          return p !== app.cache.localUser.userId;
        });

        // This shold be improved to only fetch the users not already fetched
        // before for other conversations.
        api.getUsersById(userIds).then(function (users) {
          // Set conversation.otherUsers
          conversation.otherUsers = users;

          // Set conversation.creator
          if (conversation.creatorId === app.cache.localUser.userId) {
            conversation.creator = app.cache.localUser;
          } else {
            conversation.creator = users.find(function (u) {
              u.userId === conversation.creatorId;
            });              
          }

          // Set conversation.topLevelItem.creator
          if (conversation.topLevelItem) {
            if (conversation.topLevelItem.creatorId === app.cache.localUser.userId) {
              conversation.topLevelItem.creator = app.cache.localUser;
            } else {
              conversation.topLevelItem.creator = users.find(function (u) {
                u.userId === conversation.topLevelItem.creatorId;
              });
            }
          }
  
          // Set conversation.title and conversation.avatar
          if (conversation.type === 'DIRECT') {
            var peer = conversation.otherUsers[0];
            conversation.title = peer.displayName;
            conversation.avatar = peer.avatar;
            conversation.avatarLarge = peer.avatarLarge;
          } else {
            conversation.title = conversation.topic || conversation.otherUsers.map(function (u) {
              return u.displayName;
            }).join(', ');
          }

          resolve(conversation);
        }, function (err) {
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Define a item injector to create a teaser text
  Circuit.Injectors.itemInjector = function (item) {
    // Create item.creator (conversationInjector is executed before itemInjector,
    // so this point the otherUsers are already populated)
    var conv = app.cache.conversations.find(function (c) {
      return c.convId === item.convId;
    });
    if (conv) {
      if (item.creatorId === app.cache.localUser.userId) {
        item.creator = app.cache.localUser;
      } else {
        item.creator = conv.otherUsers.find(function (u) {
          return u.userId === item.creatorId;
        });
      }
    }

    // Create item.teaser
    switch (item.type) {
      case 'RTC':
      switch (item.rtc.type) {
        case 'MISSED':
        item.teaser = 'Missed Call';
        break;
        case 'FAILED':
        item.teaser = 'Failed Call';
        break;
        default:
        item.teaser = 'Phone call';
        break;
      }
      break;

      case 'TEXT':
      // replace br and hr tags with a space
      item.teaser = item.text.content.replace(/<(br[\/]?|\/li|hr[\/]?)>/gi, ' ');
      break;

      case 'SYSTEM':
      switch (item.system.type) {
        case 'CONVERSATION_CREATED':
        item.teaser = 'New conversation';
        break;
        case 'PARTICIPANT_ADDED':
        item.teaser = 'Participant added';
        break;
        case 'PARTICIPANT_REMOVED':
        item.teaser = 'Participant removed';
        break;
        case 'CONVERSATION_RENAMED':
        item.teaser = 'Conversation renamed';
        break;
        default:
        item.teaser = '';
        break;
      }
      break;
    }
  };


  // ======================================
  // Event Listeners
  // ======================================

  function setupEventListeners() {

    api.addEventListener('conversationCreated', function (evt) {
      var conv = evt.conversation;
      app.unshift('cache.conversations', conv);
    });

    api.addEventListener('conversationUpdated', function (evt) {
      var conv = evt.conversation;
      var idx = cacheApi.getConversationIndex(conv.convId);
      if (idx >= 0) {
        // Copying the array is a workaround until Polymer provides a way to notify
        // object replacements in arrays. We could just update the individual
        // attributes of the conversation using the set method.
        // replace in an array. E.g.
        //app.set(['cache.conversations', idx, 'topicEscaped'], evt.data.topicEscaped);
        
        app.cache.conversations[idx] = conv;
        app.cache.conversations = app.cache.conversations.sort(app.conversationCompare);
      }
    });

    api.addEventListener('itemAdded', function (evt) {
      var item = evt.item;
      var idx = cacheApi.getConversationIndex(item.convId);
      if (idx >= 0) {
        app.set('cache.conversations.' + idx + '.topLevelItem', item);
        app.cache.conversations = app.cache.conversations.sort(app.conversationCompare);
      } else {
        console.log('Conversation not found in  cache: ' + item.convId);
      }
    });

    api.addEventListener('userPresenceChanged', function (evt) {
      var presenceState = evt.presenceState;
      var idx = cacheApi.getUserIndex(presenceState.userId);
      if (idx >= 0) {
        // Note that we are resetting the whole userPresenceState object,
        // which means the elements need to observe userPresenceState
        // and not userPresenceState.state
        app.cache.users[idx].userPresenceState = presenceState;
        app.set('cache.users.' + idx + '.userPresenceState', presenceState);
      }
    });

    api.addEventListener('userUpdated', function (evt) {
      var user = evt.user;
      // Find user and update it
      var idx;
      app.cache.users.some(function(u, i) {
        if (u.userId === user.userId) {
          idx = i;
          return true;
        }
      });
      if (idx) {
        app.cache.users[idx] = user;
        document.querySelector('#userList').update(user);
      }

      // Update local user
      if (user.userId === app.cache.localUser.userId) {
        app.cache.localUser = user;
      }
    });
  }

  // Start app
  api.isAuthenticated().then(function () {
    init();      
  }, function () {
    app.$.router.go('/login');
  });

  // ======================================
  // Moment configuration. Moment does not support multiple calendars
  // for the same language. So as workaround create two custom languages.
  // ======================================
  moment.locale('custom-short', {
      calendar : {
          lastDay : 'ddd',
          sameDay : 'LT',
          nextDay : '[Tomorrow at] LT',
          lastWeek : 'ddd',
          nextWeek : 'dddd [at] LT',
          sameElse : 'MMM DD'
      }
  });
  moment.locale('custom-long', {
    calendar : {
        lastDay : '[Yesterday at] LT',
        sameDay : '[Today at] LT',
        nextDay : '[Tomorrow at] LT',
        lastWeek : '[Last] dddd [at] LT',
        nextWeek : 'dddd [at] LT',
        sameElse : 'L'
    }
  });
})(document);