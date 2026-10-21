/**
 * Prangon Lite — seed data for the in-browser mock backend (dev/testing only).
 *
 * Provides a realistic slice of Prangon content: three demo identities that
 * follow and message each other, a home feed of posts and reels, stories,
 * circles, pages, notifications, wallet and store rows. Everything is
 * in-memory (persisted to localStorage by the mock engine) — no database.
 * `window.__prangonResetMockData()` restores this seed.
 */
import type { MockSeed, Row } from "./mockTypes";
import { avatarDataUri, coverDataUri, photoUrl } from "./placeholderImages";

// ---------------------------------------------------------------- identities

export const DEMO_A = "11111111-1111-4111-8111-111111111111";
export const DEMO_B = "22222222-2222-4222-8222-222222222222";
export const DEMO_C = "33333333-3333-4333-8333-333333333333";

let seq = 0;
const uid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

const ago = (h: number, m = 0) =>
  new Date(Date.now() - (h * 60 + m) * 60 * 1000).toISOString();
const ahead = (h: number) =>
  new Date(Date.now() + h * 3600 * 1000).toISOString();

export const PEOPLE: Row[] = [
  { id: DEMO_A, username: "demo_a", display_name: "Demo User A", bio: "The default demo identity.", is_verified: false },
  { id: DEMO_B, username: "demo_b", display_name: "Demo User B", bio: "Follow and message this account to test relationships.", is_verified: true },
  { id: DEMO_C, username: "demo_c", display_name: "Demo User C", bio: "Useful for testing list counts and a second conversation.", is_verified: false },
  { id: uid(), username: "ayesha_r", display_name: "Ayesha Rahman", bio: "Photographer. Chasing golden hour in Old Dhaka.", is_verified: true },
  { id: uid(), username: "tanvir_k", display_name: "Tanvir Karim", bio: "Reels about street food. Modest about it.", is_verified: false },
  { id: uid(), username: "nusrat_j", display_name: "Nusrat Jahan", bio: "Poetry, plants, and long bus rides.", is_verified: false },
  { id: uid(), username: "shafin_m", display_name: "Shafin Mahmud", bio: "Cricket on weekends, code on weekdays.", is_verified: false },
  { id: uid(), username: "mira_p", display_name: "Mira Parveen", bio: "Designing things you will scroll past beautifully.", is_verified: true },
  { id: uid(), username: "rashid_h", display_name: "Rashid Hossain", bio: "Travel diaries from every district.", is_verified: false },
];

const U = Object.fromEntries(PEOPLE.map((p) => [p.username, p.id])) as Record<string, string>;

const SAMPLE_VIDEOS = [
  "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://media.w3.org/2010/05/sintel/trailer.mp4",
];

export function createSeed(): MockSeed {
  return {
    version: "prangon-mock-v1",
    authUsers: buildAuthUsers(),
    identities: {
      demo_a: "demo_a@prangon.lite",
      demo_b: "demo_b@prangon.lite",
      demo_c: "demo_c@prangon.lite",
    },
    tables: buildTables,
    relations: RELATIONS,
    rpcs: buildRpcs(),
    prepareRow,
  };
}

function buildAuthUsers(): Record<string, Row> {
  const meta: Record<string, { id: string; username: string; name: string }> = {
    "demo_a@prangon.lite": { id: DEMO_A, username: "demo_a", name: "Demo User A" },
    "demo_b@prangon.lite": { id: DEMO_B, username: "demo_b", name: "Demo User B" },
    "demo_c@prangon.lite": { id: DEMO_C, username: "demo_c", name: "Demo User C" },
  };
  const users: Record<string, Row> = {};
  for (const [email, m] of Object.entries(meta)) {
    users[email] = {
      id: m.id,
      aud: "authenticated",
      role: "authenticated",
      email,
      email_confirmed_at: "2026-01-01T00:00:00.000Z",
      phone: "",
      confirmed_at: "2026-01-01T00:00:00.000Z",
      last_sign_in_at: ago(1),
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {
        username: m.username,
        display_name: m.name,
        demo_identity_id: m.username.replace("demo_", "demo_"),
        lite_profile_ready: true,
      },
      identities: [],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: ago(1),
      is_anonymous: false,
    };
  }
  return users;
}

// Follower/following counts derived from the follow pairs seeded in buildTables.
const FOLLOW_PAIRS: Array<[string, string]> = [
  ["demo_a", "ayesha_r"], ["demo_a", "tanvir_k"], ["demo_a", "mira_p"],
  ["demo_a", "demo_b"], ["demo_a", "demo_c"],
  ["ayesha_r", "demo_a"], ["tanvir_k", "demo_a"], ["demo_b", "demo_a"],
  ["shafin_m", "demo_b"], ["nusrat_j", "ayesha_r"],
];
const FOLLOWERS: Record<string, number> = {};
const FOLLOWING: Record<string, number> = {};
for (const [a, b] of FOLLOW_PAIRS) {
  FOLLOWERS[b] = (FOLLOWERS[b] ?? 0) + 1;
  FOLLOWING[a] = (FOLLOWING[a] ?? 0) + 1;
}

// -------------------------------------------------------------------- tables

function buildTables(): Record<string, Row[]> {
  const profiles: Row[] = PEOPLE.map((p) => ({
    ...p,
    avatar_url: avatarDataUri(p.display_name),
    profile_theme: null,
    account_type: "public",
    followers_count: FOLLOWERS[p.username] ?? 0,
    following_count: FOLLOWING[p.username] ?? 0,
    social_links: {},
    created_at: ago(24 * 30),
    updated_at: ago(24),
  }));

  // ---------------------------------------------------------------- posts
  const postDefs: Array<[string, string, string | null, boolean, number, number]> = [
    // username, caption, media seed (null = text-only), is_reel, likes, comments
    ["ayesha_r", "Golden hour hits different over the old town. No filter needed 🌇", "feed-ayesha-1", false, 48, 2],
    ["tanvir_k", "Fuchka stand review: 9/10, would risk the green chutney again.", "feed-tanvir-1", false, 31, 1],
    ["nusrat_j", "“The bus window is a free cinema.” — notes from route 7.", null, false, 12, 0],
    ["shafin_m", "Match day tomorrow. Bring the noise.", "feed-shafin-1", false, 27, 1],
    ["mira_p", "New type specimen sheet — which serif wins? Swipe.", "feed-mira-1", false, 64, 2],
    ["rashid_h", "Day 12 of district tours: tea estate mornings hit different.", "feed-rashid-1", false, 39, 0],
    ["demo_b", "Testing the follow & message flow — say hi in my comments!", "feed-demoB-1", false, 18, 1],
    ["demo_b", "Second test post: archiving this one later maybe.", "feed-demoB-2", false, 5, 0],
    ["demo_c", "Lists should count me too. Hello from Demo C.", null, false, 7, 0],
    ["demo_a", "My first mock post — the demo data layer works 🎉", "feed-demoA-1", false, 3, 0],
    ["demo_a", "Posting a carousel to test the gallery view.", "feed-demoA-2", false, 2, 0],
  ];
  const posts: Row[] = [];
  const postMedia: Row[] = [];
  postDefs.forEach(([author, caption, media, isReel], i) => {
    const id = `p-${String(i + 1).padStart(3, "0")}`;
    posts.push({
      id,
      user_id: U[author],
      caption,
      media_url: media ? photoUrl(media) : null,
      media_type: media ? "image" : null,
      is_reel: isReel,
      is_archived: false,
      circle_id: null,
      views_count: pseudoCount(id, "view"),
      pinned_comment_id: null,
      likes_count: 0,
      comments_count: 0,
      created_at: ago(3 + i * 7),
      updated_at: ago(3 + i * 7),
    });
    if (media) {
      postMedia.push({ id: `pm-${i}-1`, post_id: id, media_url: photoUrl(media), media_type: "image", display_order: 0, created_at: ago(3 + i * 7) });
      if (author === "mira_p" || author === "demo_a") {
        postMedia.push({ id: `pm-${i}-2`, post_id: id, media_url: photoUrl(media + "-b"), media_type: "image", display_order: 1, created_at: ago(3 + i * 7) });
        postMedia.push({ id: `pm-${i}-3`, post_id: id, media_url: photoUrl(media + "-c"), media_type: "image", display_order: 2, created_at: ago(3 + i * 7) });
      }
    }
  });
  // Reels.
  const reelDefs: Array<[string, string, string, number, number]> = [
    ["tanvir_k", "60-second biryani trail — part 4 🍛", 1, 120, 14],
    ["ayesha_r", "Slow morning in the old city ☕", 2, 89, 6],
    ["shafin_m", "Last-over sixes compilation 🏏", 0, 210, 22],
  ];
  reelDefs.forEach(([author, caption, vidIdx], i) => {
    const id = `r-${String(i + 1).padStart(3, "0")}`;
    posts.push({
      id,
      user_id: U[author],
      caption,
      media_url: SAMPLE_VIDEOS[vidIdx as number],
      media_type: "video",
      is_reel: true,
      is_archived: false,
      circle_id: null,
      views_count: pseudoCount(id, "view"),
      pinned_comment_id: null,
      likes_count: 0,
      comments_count: 0,
      created_at: ago(2 + i * 9),
      updated_at: ago(2 + i * 9),
    });
  });

  // --------------------------------------------------------------- comments
  const comments: Row[] = [
    { id: "c-001", post_id: "p-001", user_id: U.tanvir_k, content: "This belongs on a postcard.", created_at: ago(60) },
    { id: "c-002", post_id: "p-001", user_id: U.demo_b, content: "Saving this spot for my next walk!", created_at: ago(50) },
    { id: "c-003", post_id: "p-002", user_id: U.nusrat_j, content: "The chutney is a lifestyle.", created_at: ago(45) },
    { id: "c-004", post_id: "p-005", user_id: U.demo_c, content: "Serif #2, no contest.", created_at: ago(40) },
    { id: "c-005", post_id: "p-005", user_id: U.rashid_h, content: "Depends on the body copy!", created_at: ago(38) },
    { id: "c-006", post_id: "p-004", user_id: U.demo_b, content: "Bringing flags. 🏁", created_at: ago(20) },
    { id: "c-007", post_id: "p-007", user_id: U.demo_a, content: "Hi back 👋", created_at: ago(10) },
  ];

  const likes: Row[] = [
    { id: "l-001", post_id: "p-001", user_id: U.tanvir_k, created_at: ago(59) },
    { id: "l-002", post_id: "p-001", user_id: U.demo_b, created_at: ago(51) },
    { id: "l-003", post_id: "p-002", user_id: U.demo_a, created_at: ago(44) },
    { id: "l-004", post_id: "p-004", user_id: U.demo_a, created_at: ago(21) },
    { id: "l-005", post_id: "p-007", user_id: U.demo_a, created_at: ago(9) },
  ];

  // Compute denormalized counts so cards show real numbers.
  for (const p of posts) {
    p.likes_count = likes.filter((l) => l.post_id === p.id).length + pseudoCount(p.id, "like");
    p.comments_count = comments.filter((c) => c.post_id === p.id).length + pseudoCount(p.id, "comment");
  }

  // --------------------------------------------------------------- follows
  const follows: Row[] = [];
  const follow = (a: string, b: string, h: number) =>
    follows.push({ follower_id: U[a], following_id: U[b], created_at: ago(h) });
  follow("demo_a", "ayesha_r", 200);
  follow("demo_a", "tanvir_k", 180);
  follow("demo_a", "mira_p", 150);
  follow("demo_a", "demo_b", 90);
  follow("demo_a", "demo_c", 88);
  follow("ayesha_r", "demo_a", 170);
  follow("tanvir_k", "demo_a", 160);
  follow("demo_b", "demo_a", 95);
  follow("shafin_m", "demo_b", 120);
  follow("nusrat_j", "ayesha_r", 110);

  const friend_requests: Row[] = [
    { id: "fr-001", from_user_id: U.demo_b, to_user_id: U.demo_a, status: "pending", created_at: ago(26), updated_at: ago(26) },
  ];
  const friendships: Row[] = [
    { id: "fs-001", user_id: U.demo_a, friend_id: U.demo_c, created_at: ago(85) },
    { id: "fs-002", user_id: U.demo_c, friend_id: U.demo_a, created_at: ago(85) },
  ];

  // ------------------------------------------------------- lite messaging
  const liteConversations: Row[] = [
    { id: "conv-001", pair_key: `${DEMO_A}::${DEMO_B}`, created_at: ago(70), last_message_at: ago(4), last_message_preview: "Okay, sending that test reel now 🎬" },
    { id: "conv-002", pair_key: `${DEMO_A}::${DEMO_C}`, created_at: ago(80), last_message_at: ago(30), last_message_preview: "Lists look right on my end." },
  ];
  const liteParticipants: Row[] = [
    { conversation_id: "conv-001", user_id: U.demo_a, joined_at: ago(70), last_read_at: ago(6) },
    { conversation_id: "conv-001", user_id: U.demo_b, joined_at: ago(70), last_read_at: ago(3) },
    { conversation_id: "conv-002", user_id: U.demo_a, joined_at: ago(80), last_read_at: ago(29) },
    { conversation_id: "conv-002", user_id: U.demo_c, joined_at: ago(80), last_read_at: ago(28) },
  ];
  const liteMessages: Row[] = [
    { id: "lm-001", conversation_id: "conv-001", sender_id: U.demo_b, body: "Hey! Testing the follow flow worked — you show up in my list.", created_at: ago(69), delivered_at: ago(69), read_at: ago(6) },
    { id: "lm-002", conversation_id: "conv-001", sender_id: U.demo_a, body: "Great, messages work too then. 🎉", created_at: ago(65), delivered_at: ago(65), read_at: ago(60) },
    { id: "lm-003", conversation_id: "conv-001", sender_id: U.demo_b, body: "Can you see the demo identity switcher?", created_at: ago(6), delivered_at: ago(6), read_at: null },
    { id: "lm-004", conversation_id: "conv-001", sender_id: U.demo_b, body: "Okay, sending that test reel now 🎬", created_at: ago(4), delivered_at: ago(4), read_at: null },
    { id: "lm-005", conversation_id: "conv-002", sender_id: U.demo_c, body: "Counted twice in the list? Checking.", created_at: ago(31), delivered_at: ago(31), read_at: ago(29) },
    { id: "lm-006", conversation_id: "conv-002", sender_id: U.demo_a, body: "Looks right on my end.", created_at: ago(30), delivered_at: ago(30), read_at: ago(29) },
  ];

  // --------------------------------------------------------- notifications
  const notifications: Row[] = [
    { id: "n-001", user_id: U.demo_a, from_user_id: U.demo_b, type: "like", title: "New like", message: "Demo User B liked your post", action_url: "/post/p-007", is_read: false, created_at: ago(9) },
    { id: "n-002", user_id: U.demo_a, from_user_id: U.demo_b, type: "comment", title: "New comment", message: "Demo User B commented: Hi back 👋", action_url: "/post/p-007", is_read: false, created_at: ago(10) },
    { id: "n-003", user_id: U.demo_a, from_user_id: U.demo_b, type: "friend_request", title: "Friend request", message: "Demo User B sent you a friend request", action_url: "/friends", is_read: false, created_at: ago(26) },
    { id: "n-004", user_id: U.demo_a, from_user_id: U.demo_c, type: "friend_accept", title: "Friend accepted", message: "Demo User C accepted your friend request", action_url: "/profile/demo_c", is_read: true, created_at: ago(85) },
    { id: "n-005", user_id: U.demo_b, from_user_id: U.demo_a, type: "like", title: "New like", message: "Demo User A liked your post", action_url: "/post/p-007", is_read: false, created_at: ago(9) },
  ];

  // --------------------------------------------------------------- stories
  const stories: Row[] = [
    { id: "s-001", user_id: U.demo_b, media_url: photoUrl("story-demoB", 900, 1600), media_type: "image", created_at: ago(5), expires_at: ahead(19), views_count: 2, is_archived: false },
    { id: "s-002", user_id: U.ayesha_r, media_url: photoUrl("story-ayesha", 900, 1600), media_type: "image", created_at: ago(8), expires_at: ahead(16), views_count: 5, is_archived: false },
    { id: "s-003", user_id: U.tanvir_k, media_url: SAMPLE_VIDEOS[1], media_type: "video", created_at: ago(2), expires_at: ahead(22), views_count: 1, is_archived: false },
  ];
  const storyViews: Row[] = [
    { id: "sv-001", story_id: "s-002", viewer_id: U.demo_a, viewed_at: ago(7) },
  ];

  // ------------------------------------------------------ circles & pages
  const communityGroups: Row[] = [
    { id: "g-001", name: "Dhaka Foodies", description: "Street food finds, restaurant reviews, and recipes.", category: "Food", banner_url: coverDataUri("g-001", "Dhaka Foodies"), logo_url: avatarDataUri("Dhaka Foodies"), privacy: "public", created_by: U.tanvir_k, members_count: 3, posts_count: 2, created_at: ago(300), updated_at: ago(20) },
    { id: "g-002", name: "Film Photography BD", description: "Shooting film in a digital world.", category: "Photography", banner_url: coverDataUri("g-002", "Film Photography BD"), logo_url: avatarDataUri("Film Photography BD"), privacy: "public", created_by: U.ayesha_r, members_count: 2, posts_count: 1, created_at: ago(280), updated_at: ago(40) },
    { id: "g-003", name: "Cricket Club", description: "Weekend matches and fantasy leagues.", category: "Sports", banner_url: coverDataUri("g-003", "Cricket Club"), logo_url: avatarDataUri("Cricket Club"), privacy: "private", created_by: U.shafin_m, members_count: 2, posts_count: 0, created_at: ago(260), updated_at: ago(60) },
  ];
  const communityGroupMembers: Row[] = [
    { id: "gm-001", group_id: "g-001", user_id: U.demo_a, role: "member", joined_at: ago(150) },
    { id: "gm-002", group_id: "g-001", user_id: U.tanvir_k, role: "admin", joined_at: ago(300) },
    { id: "gm-003", group_id: "g-001", user_id: U.demo_b, role: "member", joined_at: ago(90) },
    { id: "gm-004", group_id: "g-002", user_id: U.ayesha_r, role: "admin", joined_at: ago(280) },
    { id: "gm-005", group_id: "g-002", user_id: U.demo_a, role: "member", joined_at: ago(100) },
    { id: "gm-006", group_id: "g-003", user_id: U.shafin_m, role: "admin", joined_at: ago(260) },
  ];
  const communityGroupPosts: Row[] = [
    { id: "gp-001", group_id: "g-001", user_id: U.tanvir_k, content: "Best fuchka joint — vote in the poll 📊", media_url: photoUrl("group-fuchka"), created_at: ago(18) },
    { id: "gp-002", group_id: "g-001", user_id: U.demo_a, content: "New here — recommendations for Chawkbazar?", created_at: ago(8) },
    { id: "gp-003", group_id: "g-002", user_id: U.ayesha_r, content: "Portra 400 vs the new Gold. Scans attached.", media_url: photoUrl("group-film"), created_at: ago(38) },
  ];

  const pages: Row[] = [
    { id: "pg-001", name: "Prangon Daily", description: "News and notes from the Prangon team.", category: "News", banner_url: coverDataUri("pg-001", "Prangon Daily"), logo_url: avatarDataUri("Prangon Daily"), privacy: "public", created_by: U.mira_p, followers_count: 2, posts_count: 1, created_at: ago(320), updated_at: ago(15) },
    { id: "pg-002", name: "Street Lens", description: "A page for street photography.", category: "Photography", banner_url: coverDataUri("pg-002", "Street Lens"), logo_url: avatarDataUri("Street Lens"), privacy: "public", created_by: U.ayesha_r, followers_count: 1, posts_count: 1, created_at: ago(300), updated_at: ago(45) },
  ];
  const pageMembers: Row[] = [
    { id: "pmem-001", page_id: "pg-001", user_id: U.mira_p, role: "admin", joined_at: ago(320) },
    { id: "pmem-002", page_id: "pg-001", user_id: U.demo_a, role: "follower", joined_at: ago(120) },
    { id: "pmem-003", page_id: "pg-002", user_id: U.ayesha_r, role: "admin", joined_at: ago(300) },
  ];
  const pagePosts: Row[] = [
    { id: "pp-001", page_id: "pg-001", caption: "Welcome to Prangon Lite — demo data is live.", media_url: null, media_type: null, likes_count: 4, comments_count: 0, created_at: ago(15), updated_at: ago(15) },
    { id: "pp-002", page_id: "pg-002", caption: "Morning fog on the flyover.", media_url: photoUrl("page-fog"), media_type: "image", likes_count: 9, comments_count: 0, created_at: ago(44), updated_at: ago(44) },
  ];

  // --------------------------------------------------- wallet, store, misc
  const wallets: Row[] = [
    { id: "w-001", user_id: U.demo_a, balance: 500, total_received: 700, total_sent: 200, created_at: ago(400), updated_at: ago(12) },
    { id: "w-002", user_id: U.demo_b, balance: 250, total_received: 250, total_sent: 0, created_at: ago(390), updated_at: ago(50) },
    { id: "w-003", user_id: U.demo_c, balance: 120, total_received: 120, total_sent: 0, created_at: ago(380), updated_at: ago(70) },
  ];
  const walletTransactions: Row[] = [
    { id: "wt-001", user_id: U.demo_a, type: "purchase", amount: 500, status: "completed", reference: "BKASH-TEST-001", sender_number: "01700000000", payment_method: "bKash", related_user_id: null, created_at: ago(400) },
    { id: "wt-002", user_id: U.demo_a, type: "gift_received", amount: 200, status: "completed", reference: null, sender_number: null, payment_method: null, related_user_id: U.demo_b, created_at: ago(12) },
  ];
  const storeItems: Row[] = [
    { id: "si-001", name: "Golden Badge", description: "A shiny badge for your profile.", category: "badge", price: 100, icon: "🏅", is_active: true, metadata: {}, created_at: ago(500) },
    { id: "si-002", name: "Confetti Burst", description: "Animated confetti on your posts.", category: "decoration", price: 50, icon: "🎉", is_active: true, metadata: {}, created_at: ago(500) },
    { id: "si-003", name: "Profile Boost", description: "Boost your profile for 24 hours.", category: "boost", price: 250, icon: "🚀", is_active: true, metadata: {}, created_at: ago(500) },
    { id: "si-004", name: "Thank You Gift", description: "Send a thank-you gift to a friend.", category: "gift", price: 30, icon: "💐", is_active: true, metadata: {}, created_at: ago(500) },
  ];
  const userSettings: Row[] = [DEMO_A, DEMO_B, DEMO_C].map((id, i) => ({
    id: `us-${i + 1}`,
    user_id: id,
    theme: "system",
    notifications_enabled: true,
    email_notifications: false,
    two_factor_enabled: false,
    created_at: ago(400),
    updated_at: ago(20),
  }));
  const userRoles: Row[] = [DEMO_A, DEMO_B, DEMO_C].map((id, i) => ({
    id: `ur-${i + 1}`,
    user_id: id,
    role: "user",
    created_at: ago(400),
  }));
  const appSettings: Row[] = [
    { id: "as-001", setting_key: "maintenance_mode", setting_value: { enabled: false }, description: "Global maintenance switch", updated_at: ago(100), updated_by: null },
    { id: "as-002", setting_key: "min_app_version", setting_value: { version: "0.0.1" }, description: "Minimum supported app version", updated_at: ago(100), updated_by: null },
    { id: "as-003", setting_key: "wallet_topup", setting_value: { min: 10, max: 5000 }, description: "Wallet top-up limits", updated_at: ago(100), updated_by: null },
  ];
  const savedPosts: Row[] = [
    { id: "sp-001", user_id: U.demo_a, post_id: "p-001", created_at: ago(55) },
  ];

  return {
    profiles,
    posts,
    post_media: postMedia,
    comments,
    likes,
    follows,
    friend_requests,
    friendships,
    lite_conversations: liteConversations,
    lite_participants: liteParticipants,
    lite_messages: liteMessages,
    conversations: [],
    conversation_participants: [],
    messages: [],
    notifications,
    stories,
    story_views: storyViews,
    story_highlights: [],
    story_reactions: [],
    community_groups: communityGroups,
    community_group_members: communityGroupMembers,
    community_group_posts: communityGroupPosts,
    circle_invitations: [],
    pages,
    page_members: pageMembers,
    page_posts: pagePosts,
    wallets,
    wallet_transactions: walletTransactions,
    store_items: storeItems,
    store_purchases: [],
    user_settings: userSettings,
    user_roles: userRoles,
    app_settings: appSettings,
    saved_posts: savedPosts,
    pinned_posts: [],
    blocked_users: [],
    feed_events: [],
    user_notes: [],
    user_interests: [],
    user_devices: [],
    push_subscriptions: [],
    reports: [],
    comment_reactions: [],
    note_reactions: [],
    message_reactions: [],
    chat_preferences: [],
    post_reactions: [],
    post_views: [],
  };
}

function bumpProfileCount(tables: Record<string, Row[]>, userId: string, field: string, delta: number) {
  const p = (tables.profiles ?? []).find((x) => x.id === userId);
  if (p) p[field] = Math.max((p[field] ?? 0) + delta, 0);
}

/** Stable pseudo-random extra counts so cards feel lively. */
function pseudoCount(id: string, kind: string): number {
  let h = 0;
  for (const ch of id + kind) h = (h * 33 + ch.charCodeAt(0)) % 997;
  return h % 7;
}

// ----------------------------------------------------------------- relations

const RELATIONS: MockSeed["relations"] = {
  posts: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
    post_media: { column: "post_id", kind: "in", tableName: "post_media" },
    likes: { column: "post_id", kind: "in", tableName: "likes" },
    comments: { column: "post_id", kind: "in", tableName: "comments" },
    pinned_posts: { column: "post_id", kind: "in", tableName: "pinned_posts" },
  },
  comments: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
  },
  likes: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
  },
  stories: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
    story_views: { column: "story_id", kind: "in", tableName: "story_views" },
  },
  story_views: {
    profiles: { column: "viewer_id", kind: "out", tableName: "profiles" },
  },
  notifications: {
    profiles: { column: "from_user_id", kind: "out", tableName: "profiles" },
    from_user: { column: "from_user_id", kind: "out", tableName: "profiles" },
  },
  lite_participants: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
    lite_conversations: { column: "conversation_id", kind: "out", tableName: "lite_conversations" },
  },
  lite_messages: {
    profiles: { column: "sender_id", kind: "out", tableName: "profiles" },
    lite_conversations: { column: "conversation_id", kind: "out", tableName: "lite_conversations" },
  },
  lite_conversations: {
    lite_participants: { column: "conversation_id", kind: "in", tableName: "lite_participants" },
    lite_messages: { column: "conversation_id", kind: "in", tableName: "lite_messages" },
  },
  community_groups: {
    community_group_members: { column: "group_id", kind: "in", tableName: "community_group_members" },
    community_group_posts: { column: "group_id", kind: "in", tableName: "community_group_posts" },
  },
  community_group_members: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
    community_groups: { column: "group_id", kind: "out", tableName: "community_groups" },
  },
  community_group_posts: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
    community_groups: { column: "group_id", kind: "out", tableName: "community_groups" },
  },
  pages: {
    page_members: { column: "page_id", kind: "in", tableName: "page_members" },
    page_posts: { column: "page_id", kind: "in", tableName: "page_posts" },
  },
  page_members: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
  },
  saved_posts: {
    posts: { column: "post_id", kind: "out", tableName: "posts" },
  },
  friendships: {
    profiles: { column: "friend_id", kind: "out", tableName: "profiles" },
  },
  wallets: {
    profiles: { column: "user_id", kind: "out", tableName: "profiles" },
  },
};

// ---------------------------------------------------------------------- rpcs

function buildRpcs(): NonNullable<MockSeed["rpcs"]> {
  const me = (_tables: Record<string, Row[]>, ctx: any) => ctx.getUserId();

  const pairKey = (a: string, b: string) =>
    a < b ? `${a}::${b}` : `${b}::${a}`;

  return {
    follow_user: (args, tables, ctx) => {
      const mine = ctx.getUserId();
      const target = args.p_target ?? args.target;
      if (!mine || !target || target === mine) return { ok: false, error: "invalid_target" };
      const exists = (tables.follows ?? []).some(
        (f) => f.follower_id === mine && f.following_id === target,
      );
      if (!exists) {
        tables.follows?.push({ follower_id: mine, following_id: target, created_at: ago(0) });
        bumpProfileCount(tables, target, "followers_count", +1);
        bumpProfileCount(tables, mine, "following_count", +1);
      }
      return { ok: true, following: true };
    },

    unfollow_user: (args, tables, ctx) => {
      const mine = ctx.getUserId();
      const target = args.p_target ?? args.target;
      if (!mine || !target) return { ok: false, error: "invalid_target" };
      const before = (tables.follows ?? []).length;
      tables.follows = (tables.follows ?? []).filter(
        (f) => !(f.follower_id === mine && f.following_id === target),
      );
      if (tables.follows.length < before) {
        bumpProfileCount(tables, target, "followers_count", -1);
        bumpProfileCount(tables, mine, "following_count", -1);
      }
      return { ok: true, following: false };
    },

    has_role: (args, tables, ctx) => {
      const uidArg = args._user_id ?? args.user_id;
      const roleArg = args._role ?? args.role ?? "user";
      if (uidArg !== ctx.getUserId()) return roleArg === "user";
      return tables.user_roles?.some((r) => r.user_id === uidArg && r.role === roleArg) ?? roleArg === "user";
    },

    create_notification: (args, tables) => {
      const row: Row = {
        id: uid(),
        user_id: args.p_user_id,
        from_user_id: args.p_from_user_id,
        type: args.p_type,
        title: args.p_title,
        message: args.p_message,
        action_url: args.p_action_url ?? null,
        is_read: false,
        created_at: ago(0),
      };
      tables.notifications?.push(row);
      return row.id;
    },

    lite_get_or_create_conversation: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      const other = args.p_other ?? args.p_other_user;
      if (!mine || !other || other === mine) throw new Error("Invalid conversation partner");
      const key = pairKey(mine, other);
      let conv = tables.lite_conversations.find((c) => c.pair_key === key);
      if (!conv) {
        conv = { id: uid(), pair_key: key, created_at: ago(0), last_message_at: ago(0), last_message_preview: null };
        tables.lite_conversations.push(conv);
      }
      for (const u of [mine, other]) {
        const exists = tables.lite_participants.some(
          (p) => p.conversation_id === conv!.id && p.user_id === u,
        );
        if (!exists) {
          tables.lite_participants.push({ conversation_id: conv.id, user_id: u, joined_at: ago(0), last_read_at: null });
        }
      }
      return conv.id;
    },

    lite_send_message: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      const body = String(args.p_body ?? "").trim();
      if (!mine) throw new Error("Not signed in");
      if (!body) throw new Error("Message cannot be empty");
      const row: Row = {
        id: uid(),
        conversation_id: args.p_conversation,
        sender_id: mine,
        body,
        created_at: ago(0),
        delivered_at: ago(0),
        read_at: null,
      };
      tables.lite_messages.push(row);
      const conv = tables.lite_conversations.find((c) => c.id === args.p_conversation);
      if (conv) {
        conv.last_message_at = row.created_at;
        conv.last_message_preview = body.slice(0, 120);
      }
      return row;
    },

    lite_mark_delivered: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      let n = 0;
      for (const m of tables.lite_messages ?? []) {
        if (m.conversation_id === args.p_conversation && m.sender_id !== mine && !m.delivered_at) {
          m.delivered_at = ago(0);
          n += 1;
        }
      }
      return n;
    },

    lite_mark_read: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      let n = 0;
      for (const m of tables.lite_messages ?? []) {
        if (m.conversation_id === args.p_conversation && m.sender_id !== mine && !m.read_at) {
          m.read_at = ago(0);
          m.delivered_at = m.delivered_at ?? ago(0);
          n += 1;
        }
      }
      const p = (tables.lite_participants ?? []).find(
        (x) => x.conversation_id === args.p_conversation && x.user_id === mine,
      );
      if (p) p.last_read_at = ago(0);
      return n;
    },

    lite_unread_counts: (_args, tables, ctx) => {
      const mine = me(tables, ctx);
      const mineConvs = (tables.lite_participants ?? []).filter((p) => p.user_id === mine);
      return mineConvs.map((p) => ({
        conversation_id: p.conversation_id,
        unread: (tables.lite_messages ?? []).filter(
          (m) => m.conversation_id === p.conversation_id && m.sender_id !== mine && !m.read_at,
        ).length,
      }));
    },

    increment_story_views: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      const storyId = args.p_story_id;
      const exists = (tables.story_views ?? []).some((v) => v.story_id === storyId && v.viewer_id === mine);
      if (!exists) {
        tables.story_views?.push({ id: uid(), story_id: storyId, viewer_id: mine, viewed_at: ago(0) });
      }
      const story = (tables.stories ?? []).find((s) => s.id === storyId);
      if (story) {
        story.views_count = (tables.story_views ?? []).filter((v) => v.story_id === storyId).length;
      }
      return null;
    },

    delete_post_permanently: (args, tables) => {
      const pid = args.p_post_id;
      tables.posts = (tables.posts ?? []).filter((p) => p.id !== pid);
      tables.comments = (tables.comments ?? []).filter((c) => c.post_id !== pid);
      tables.likes = (tables.likes ?? []).filter((l) => l.post_id !== pid);
      tables.post_media = (tables.post_media ?? []).filter((m) => m.post_id !== pid);
      return { post_id: pid };
    },

    delete_comment_permanently: (args, tables) => {
      const cid = args.p_comment_id;
      const comment = (tables.comments ?? []).find((c) => c.id === cid);
      tables.comments = (tables.comments ?? []).filter((c) => c.id !== cid && c.parent_comment_id !== cid);
      if (comment) {
        const post = (tables.posts ?? []).find((p) => p.id === comment.post_id);
        if (post) {
          post.comments_count = Math.max(
            (post.comments_count ?? 1) - 1,
            (tables.comments ?? []).filter((c) => c.post_id === comment.post_id).length,
          );
        }
      }
      return null;
    },

    get_or_create_direct_conversation: (args, tables, ctx) => {
      const mine = me(tables, ctx);
      const other = args.p_other_user;
      if (!mine || !other || other === mine) throw new Error("Invalid other user");
      for (const c of tables.conversations ?? []) {
        const parts = (tables.conversation_participants ?? [])
          .filter((p) => p.conversation_id === c.id)
          .map((p) => p.user_id);
        if (parts.includes(mine) && parts.includes(other)) return c.id;
      }
      const conv = { id: uid(), created_at: ago(0), updated_at: ago(0) };
      tables.conversations?.push(conv);
      for (const u of [mine, other]) {
        tables.conversation_participants?.push({ conversation_id: conv.id, user_id: u, joined_at: ago(0) });
      }
      return conv.id;
    },

    revert_expired_nitro_trials: () => null,
  };
}

function prepareRow(table: string, row: Row): Row {
  if (!row.id) row.id = uid();
  if (!row.created_at) row.created_at = ago(0);
  if (table === "likes" || table === "saved_posts") {
    const dup = false; // engine-level uniqueness is not emulated; client dedupes
    void dup;
  }
  return row;
}
