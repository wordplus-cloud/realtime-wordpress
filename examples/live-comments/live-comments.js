/**
 * The Live Comments page: new comments of the post as they are approved, and who else is reading it.
 * A plain script, on the SDK page script: the page rooms (`wordplusRealtimeClient.page()`).
 */
( function () {
	const rt = window.wordplusRealtimeClient && wordplusRealtimeClient.page(); // null on a site without its credentials
	const page = window.liveComments;

	if ( ! rt || ! page ) {
		return;
	}

	// Above the comment form, which the comments of every theme have.
	const box = document.createElement( 'div' );
	box.className = 'live-comments';
	box.setAttribute( 'aria-live', 'polite' );

	const readers = document.createElement( 'p' );
	readers.className = 'live-comments__readers';
	readers.hidden = true;

	const heading = document.createElement( 'h3' );
	heading.className = 'live-comments__heading';
	heading.textContent = page.new;
	heading.hidden = true;

	const list = document.createElement( 'ul' );
	list.className = 'live-comments__list';

	box.append( readers, heading, list );

	const form = document.getElementById( 'respond' );
	if ( form ) {
		form.before( box );
	} else {
		( document.querySelector( 'main' ) || document.body ).append( box );
	}

	const comments = rt.join( page.room );

	comments.on( 'comment', ( data ) => {
		if ( document.getElementById( 'comment-' + data.id ) || list.querySelector( '[data-id="' + data.id + '"]' ) ) {
			return;
		}

		const item = document.createElement( 'li' );
		item.dataset.id = data.id;

		const author = document.createElement( 'strong' );
		author.textContent = data.author;

		item.append( author, ' ', data.text );
		list.append( item );
		heading.hidden = false;
	} );

	comments.on( 'error', ( e ) => console.warn( 'Live Comments:', e.code ) );

	if ( ! page.readers ) {
		return;
	}

	const presence = rt.join( page.readers );
	const draw = () => {
		const names = [ ...presence.members.values() ].map( ( info ) => ( info && info.name ) || '' ).filter( Boolean );

		readers.textContent = page.reading + ' ' + names.join( ', ' );
		readers.hidden = names.length < 2; // the reader alone sees nothing
	};

	presence.on( 'joined', draw );
	presence.on( 'join', draw );
	presence.on( 'leave', draw );
	presence.on( 'error', ( e ) => console.warn( 'Live Comments:', e.code ) );
} )();
