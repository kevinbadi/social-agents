export type ZernioProfile = {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  isDefault?: boolean;
  color?: string;
  createdAt: string;
  updatedAt: string;
  accountUsernames?: string[];
};

export type ZernioAccount = {
  _id: string;
  platform: string;
  profileId: { _id: string; name: string } | string;
  displayName?: string;
  /** Some platforms expose these at the top level rather than under metadata. */
  username?: string;
  profilePicture?: string;
  profileUrl?: string;
  isActive?: boolean;
  followersCount?: number;
  /** When Zernio last re-synced followersCount from the platform API (nightly ~midnight ET). */
  followersLastUpdated?: string;
  externalPostCount?: number;
  metadata?: {
    profileData?: {
      username?: string;
      displayName?: string;
      profilePicture?: string;
      profileUrl?: string;
      followersCount?: number;
      bio?: string;
    };
  };
  createdAt: string;
};

export type ZernioPostPlatform = {
  platform: string;
  /** String id on Zernio-authored posts; populated account object on external (synced) posts. */
  accountId:
    | string
    | { _id: string; platform?: string; username?: string; displayName?: string }
    | null;
  profileId?: string;
  scheduledFor?: string;
  platformSpecificData?: Record<string, unknown>;
  customContent?: string;
  publishAttempts?: number;
  status?: string;
  /** Set by Zernio once the platform publish succeeds. */
  platformPostId?: string;
  /** Direct link to the live post on the platform (e.g. threads.com/@user/post/…). */
  platformPostUrl?: string;
  publishedAt?: string;
};

export type ZernioMediaItem = {
  _id?: string;
  type: "image" | "video";
  url: string;
  /** Poster jpg for video items (analytics docs carry it; CDN video URLs expire). */
  thumbnail?: string;
};

export type ZernioPost = {
  _id: string;
  userId: { _id: string; name?: string; email?: string; image?: string } | string;
  title?: string;
  content: string;
  mediaItems?: ZernioMediaItem[];
  platforms: ZernioPostPlatform[];
  status?: string;
  scheduledFor?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ZernioAnalyticsOverview = {
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  lastSync?: string;
};

export type ZernioPostMetrics = {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  engagementRate?: number;
};

export type ZernioAnalyticsPost = {
  _id: string;
  content: string;
  publishedAt?: string;
  scheduledFor?: string;
  status: string;
  /** Own media straight from the analytics doc — preferred for previews. */
  thumbnailUrl?: string;
  mediaType?: "image" | "video" | "carousel" | "text";
  mediaItems?: ZernioMediaItem[];
  /** Aggregate across platforms. */
  analytics: ZernioPostMetrics;
  /** Per-platform breakdown — each carries its own analytics + live post id/url. */
  platforms: {
    platform: string;
    status: string;
    platformPostId?: string;
    platformPostUrl?: string;
    accountUsername?: string;
    analytics?: ZernioPostMetrics;
  }[];
};

export type ZernioAnalyticsAccount = {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profilePicture?: string;
  profileId?: string;
  followersCount?: number;
  followersLastUpdated?: string;
};

export type ZernioAnalytics = {
  overview: ZernioAnalyticsOverview;
  posts: ZernioAnalyticsPost[];
  /** Connected accounts with follower counts — the audience/demographics source. */
  accounts?: ZernioAnalyticsAccount[];
  hasAnalyticsAccess?: boolean;
  /** Zernio paginates posts at 50/page — getAnalytics merges all pages. */
  pagination?: { page: number; limit: number; total: number; pages: number };
  /** True when at least one page could not be fetched (rate limit / error), so
   *  `posts` is a SUBSET. Any total summed from a partial set is wrong and must
   *  not be shown — see the Views headline in dashboard/page.tsx. */
  incomplete?: boolean;
};
