// The API demo page is the same in every guide (examples/shop in @wordplus/realtime, its shop.js), written against
// the connect() of @wordplus/realtime. On WordPress it runs on the scripts of the package instead, which the plugin prints
// (wordplus_realtime()->call_screen()): the page rooms (wordplusRealtimeClient.page()), its calls
// (wordplusRealtimeCalls.page()) and the Better Messages screens (wordplusRealtimeUi). The build bundles shop.js with this
// file in place of the npm package (package.json), so what follows is all there is between the two.

/** The page connected: the rooms the code of every plugin and the screens share, its calls, and the screens. */
export async function connect(config) {
    const page = window.wordplusRealtimeCalls?.page(config) ?? null;
    if (!page) throw new Error('example-shop: the site has no WordPlus Cloud credentials');

    const { rt, calls } = page;

    return {
        join: (name) => rt.join(name),
        leave: (name) => rt.leave(name),
        on: (event, fn) => rt.on(event, fn),
        off: (event, fn) => rt.off(event, fn),
        users: (ids) => rt.users(ids),
        get online() {
            return rt.online;
        },
        get tab() {
            return rt.tab;
        },
        get user() {
            return rt.user;
        },
        calls: async () => calls,
        // The screens start by themselves on a WordPress page, with the settings call_screen() printed.
        callScreen: async (settings = {}) => window.wordplusRealtimeUi?.start(settings) ?? false,
        ui: async (settings = {}) => window.wordplusRealtimeUi?.start(settings) ?? false,
        // The live stream elements, which stream_screen() printed.
        streamScreen: async (settings = {}) => window.wordplusRealtimeStreams?.start(settings) ?? false,
    };
}
