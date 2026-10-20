# Video Support

An example of the realtime SDK calls, with no call code of its own: a signed-in customer video-calls the shop support agent from any page with the `[video_support]` shortcode, and every open tab of the agent on the site rings. The shop staff have a room of their own on the same page.

- **`video-support.php`:** decides who takes part in its calls and its room: a customer calls the agent on their own call (`support:{customer}`, the customer user id) only, the agent answers it and may bring the staff into it, and the staff group call (`support-staff`) is for those who may edit the posts of others, an administrator running it, encrypted end to end. It loads the call screen, the one of Better Messages, on every page for signed-in users, and its shortcode prints the call button or the room button.
- **`composer.json`:** `wordplus/realtime`, which `composer install` puts in `vendor/`.

The agent is the first administrator, or the user the option `video_support_agent` names.

## Trying it

Copy the folder into `wp-content/plugins/`, run `composer install` in it, activate Video Support and connect the site to WordPlus Cloud from its row on the Plugins screen. Put `[video_support]` on a page, then open it as a customer in one browser and as the agent in another: the customer call rings in every tab the agent has open. Two of the staff, editors or administrators, meet in the staff room from the same page.
