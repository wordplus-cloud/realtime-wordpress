# Limits

## Rooms

| | |
|---|---|
| The name of a room | up to 200 characters of `A-Z a-z 0-9 _ - = @ , . ; :` |
| Rooms a connection holds | 1,000, for every tab and plugin of the browser |
| Rooms one token names | 100. A page asks for more in several |
| The data of an event | 1 MB, binary included |
| Rooms one emit goes to | 1,000, and users 1,000 |
| Events in one batch request | 100 |
| The members of a presence room | 100,000. The first 1,000 listed, with `join` and `leave` while it has at most that many |
| The `info` of a member | 4 KB |
| A user profile in the directory | 4 KB. 100 users a `users()` |
| Events from a page | 50 a second a connection, in bursts of 100 |
| History | 1,000 events a room, for 5 minutes at most, each kept up to 64 KB. A page of it holds 100. It is for pages that reconnect: your plugin keeps its own records from the [webhook](events.md#keeping-the-conversation) |
| Counts | at most once a second |
| Who is online | 1,000 users watched a connection. Offline 10 seconds after the last connection closes |
| The life of a room token | 6 hours by default, at most a day. Renewed by the page |
| The clock of a signed request | within 5 minutes of the server clock |

## Calls

| | |
|---|---|
| People in a call | two. Add more, and it goes on as a group call |
| Ringing | 45 seconds, then `no_answer`. A ring into a group call too |
| The connection of one side away during a call | 45 seconds to come back |
| In a room after a hand-off, the other side | a minute to arrive |
| The life of a calls token | 6 hours. Renewed by the page |
| A group call | 32 people with video, 50 audio only, whether one your plugin names or one that comes from a call |

## Staging copies

A staging copy of a site connects without using one of the subscription sites, with up to 25 people online.

## Fair use

The subscription of a site covers the rooms and calls of any plugin on it, under fair use.
