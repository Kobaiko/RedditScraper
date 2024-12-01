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

export async function searchReddit(query: string) {
  const response = await fetch(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=100`
  );
  
  if (!response.ok) {
    throw new Error('Failed to fetch from Reddit');
  }

  const data = (await response.json()) as RedditResponse;
  
  // Process the results
  const posts = data.data.children;
  const discussions = posts.map((post) => ({
    title: post.data.title,
    url: `https://reddit.com${post.data.permalink}`,
    subreddit: post.data.subreddit,
    score: post.data.score,
    author: post.data.author,
    created: new Date(post.data.created_utc * 1000).toLocaleDateString(),
    commentCount: post.data.num_comments,
    description: post.data.selftext.slice(0, 200) + (post.data.selftext.length > 200 ? '...' : '')
  }));

  // Calculate sentiment based on actual score values, not just positive/negative
  const scores = discussions.map(post => post.score);
  const totalPosts = discussions.length;
  
  // Consider scores relative to the median to better handle varying score ranges
  const median = scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  const positivePosts = discussions.filter(post => post.score > median).length;
  const negativePosts = totalPosts - positivePosts;
  
  // Calculate sentiment based on the ratio of posts above/below median
  const positiveRatio = positivePosts / totalPosts;
  
  let sentiment;
  if (positiveRatio >= 0.8) {
    sentiment = "Very Positive";
  } else if (positiveRatio >= 0.6) {
    sentiment = "Mostly Positive";
  } else if (positiveRatio >= 0.4) {
    sentiment = "Mixed";
  } else if (positiveRatio >= 0.2) {
    sentiment = "Mostly Negative";
  } else {
    sentiment = "Very Negative";
  }

  // Extract unique subreddits as topics
  const topics = Array.from(new Set(discussions.map((post) => post.subreddit)));

  return {
    sentiment,
    topics,
    discussions: discussions.map((d) => ({
      text: d.title,
      url: d.url,
      author: d.author,
      created: d.created,
      commentCount: d.commentCount,
      description: d.description,
      score: d.score
    }))
  };
}