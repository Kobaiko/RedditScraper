interface RedditPost {
  data: {
    title: string;
    permalink: string;
    subreddit: string;
    score: number;
    author: string;
    created_utc: number;
    num_comments: number;
    selftext: string;
  }
}

interface RedditResponse {
  data: {
    children: Array<{ data: RedditPost['data'] }>;
  }
}

export const REDDIT_CONFIG = {
  clientId: import.meta.env.VITE_REDDIT_CLIENT_ID,
  clientSecret: import.meta.env.VITE_REDDIT_SECRET
};

const API_URL = import.meta.env.VITE_API_URL || 'https://www.reddit.com';

let accessToken: string | null = null;
let tokenExpiration: number = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiration) {
    return accessToken;
  }

  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${REDDIT_CONFIG.clientId}:${REDDIT_CONFIG.clientSecret}`)}`
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error('Failed to get access token');
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiration = Date.now() + (data.expires_in * 1000);
  return accessToken;
}

export async function searchReddit(query: string) {
  try {
    const token = await getAccessToken();
    
    const headers = new Headers({
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'SentimentAnalyzer/1.0'
    });

    const response = await fetch(
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=100`,
      { headers }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const posts = data.data.children;
    
    // Process posts
    const processedPosts = posts.map(post => ({
      id: post.data.id,
      title: post.data.title,
      url: post.data.permalink,
      subreddit: post.data.subreddit,
      score: post.data.score,
      num_comments: post.data.num_comments,
      created_utc: post.data.created_utc,
      sentiment: calculateSentiment(post.data.score, post.data.upvote_ratio || 0.5)
    }));

    // Calculate subreddit statistics
    const subredditStats = {};
    processedPosts.forEach(post => {
      if (!subredditStats[post.subreddit]) {
        subredditStats[post.subreddit] = {
          total: 0,
          positive: 0,
          negative: 0,
          neutral: 0
        };
      }
      
      subredditStats[post.subreddit].total++;
      if (post.sentiment === 'positive') subredditStats[post.subreddit].positive++;
      else if (post.sentiment === 'negative') subredditStats[post.subreddit].negative++;
      else subredditStats[post.subreddit].neutral++;
    });

    return {
      posts: processedPosts,
      subreddit_sentiment: subredditStats
    };
  } catch (error) {
    console.error('Error fetching data:', error);
    throw error;
  }
}

function calculateSentiment(score: number, upvoteRatio: number): 'positive' | 'negative' | 'neutral' {
  if (score > 10 && upvoteRatio > 0.6) return 'positive';
  if (score < 0 || upvoteRatio < 0.4) return 'negative';
  return 'neutral';
}