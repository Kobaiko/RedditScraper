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

const API_URL = import.meta.env.VITE_API_URL || 'https://www.reddit.com';

export async function searchReddit(query: string) {
  try {
    // Direct Reddit API call
    const response = await fetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=100`
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