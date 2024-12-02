const path = require('path');
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const query = event.path.split('/').pop();
    if (!query) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No search query provided' })
      };
    }

    // Get Reddit access token
    const authResponse = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });

    const authData = await authResponse.json();
    if (!authData.access_token) {
      throw new Error('Failed to get Reddit access token');
    }

    // Search Reddit
    const searchResponse = await fetch(
      `https://oauth.reddit.com/search?q=${encodeURIComponent(query)}&limit=100`,
      {
        headers: {
          'Authorization': `Bearer ${authData.access_token}`,
          'User-Agent': 'SentimentAnalyzer/1.0'
        }
      }
    );

    const searchData = await searchResponse.json();
    const posts = searchData.data.children.map(child => ({
      id: child.data.id,
      title: child.data.title,
      score: child.data.score,
      num_comments: child.data.num_comments,
      created_utc: child.data.created_utc,
      subreddit: child.data.subreddit,
      url: child.data.url,
      selftext: child.data.selftext || '',
      sentiment: analyzeSentiment(child.data.title + ' ' + (child.data.selftext || ''), child.data.score, child.data.num_comments, child.data.created_utc)
    }));

    // Calculate sentiment stats
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0 };
    const subredditSentiment = {};

    posts.forEach(post => {
      sentimentCounts[post.sentiment]++;
      
      if (!subredditSentiment[post.subreddit]) {
        subredditSentiment[post.subreddit] = { positive: 0, negative: 0, neutral: 0 };
      }
      subredditSentiment[post.subreddit][post.sentiment]++;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        posts,
        overall_sentiment: sentimentCounts,
        subreddit_sentiment: subredditSentiment,
        total_posts: posts.length
      })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

function analyzeSentiment(text, score = 0, numComments = 0, created = '') {
  // Clean and normalize text
  text = text.toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  const words = text.split(/\s+/);
  
  // Calculate engagement metrics
  const engagementScore = calculateEngagementScore(score, numComments);
  
  // Calculate content metrics
  const contentScore = calculateContentScore(text, words);
  
  // Calculate time-based metrics
  const timeScore = calculateTimeScore(created);
  
  // Combine all factors with appropriate weights
  const finalScore = (
    contentScore * 0.6 +    // Content is most important
    engagementScore * 0.3 + // Engagement is second
    timeScore * 0.1         // Time decay has least impact
  );

  // Very aggressive thresholds favoring negative sentiment
  if (finalScore > 0.5) return 'positive';
  if (finalScore < -0.1) return 'negative'; // Much easier to be negative
  return 'neutral';
}

function calculateEngagementScore(score, numComments) {
  let engagementScore = 0;

  // Negative comments are more likely on controversial posts
  if (numComments > 100) {
    engagementScore -= 0.2;
  }
  if (numComments > 500) {
    engagementScore -= 0.3;
  }

  // Very negative scores should count more than very positive ones
  if (score < 0) {
    engagementScore += Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.3;
  } else {
    engagementScore += Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.15;
  }

  return engagementScore;
}

function calculateContentScore(text, words) {
  let contentScore = 0;
  let wordCount = 0;

  // Sentiment dictionaries with weighted scores
  const sentimentDict = {
    // Strong negative terms (-2)
    'terrible': -2, 'horrible': -2, 'awful': -2, 'worst': -2, 'hate': -2,
    'disaster': -2, 'fail': -2, 'failed': -2, 'failing': -2, 'useless': -2,
    'garbage': -2, 'waste': -2, 'scam': -2, 'broken': -2, 'unusable': -2,
    'crash': -2, 'crashes': -2, 'bug': -2, 'bugs': -2, 'error': -2,
    'errors': -2, 'poor': -2, 'disappointed': -2, 'disappointing': -2,
    'avoid': -2, 'awful': -2, 'terrible': -2, 'horrible': -2,
    
    // Moderate negative terms (-1)
    'bad': -1, 'issue': -1, 'issues': -1, 'problem': -1, 'problems': -1,
    'slow': -1, 'difficult': -1, 'hard': -1, 'confusing': -1, 'confused': -1,
    'expensive': -1, 'pricey': -1, 'costly': -1, 'overpriced': -1,
    'annoying': -1, 'frustrating': -1, 'mediocre': -1, 'meh': -1,
    'lacking': -1, 'missing': -1, 'weak': -1, 'unstable': -1,
    
    // Moderate positive terms (1)
    'good': 1, 'nice': 1, 'okay': 1, 'decent': 1, 'fine': 1,
    'works': 1, 'working': 1, 'helpful': 1, 'useful': 1, 'stable': 1,
    'clean': 1, 'simple': 1, 'easy': 1, 'smooth': 1, 'solid': 1,
    
    // Strong positive terms (1.5 - intentionally weaker than negative)
    'great': 1.5, 'excellent': 1.5, 'amazing': 1.5, 'awesome': 1.5,
    'perfect': 1.5, 'fantastic': 1.5, 'wonderful': 1.5, 'best': 1.5,
    'love': 1.5, 'superb': 1.5, 'outstanding': 1.5, 'brilliant': 1.5
  };

  // Check for negations that flip sentiment
  const negations = ['not', 'no', 'never', 'dont', 'doesn\'t', 'isnt', 'cant', 'wont', 'wouldn\'t'];
  
  // First pass: basic sentiment
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (sentimentDict[word] !== undefined) {
      // Check for preceding negation
      if (i > 0 && negations.includes(words[i-1])) {
        contentScore -= sentimentDict[word] * 1.5; // Negated terms count more
      } else {
        contentScore += sentimentDict[word];
      }
      wordCount++;
    }
  }

  // Look for complaint patterns
  const complaintPatterns = [
    'why does', 'why do', 'how come', 'what happened',
    'anyone else', 'is it just me', 'doesn\'t work'
  ];
  
  complaintPatterns.forEach(pattern => {
    if (text.includes(pattern)) {
      contentScore -= 0.5;
    }
  });

  // Normalize by word count, but maintain some impact of multiple sentiments
  if (wordCount > 0) {
    contentScore = contentScore / Math.sqrt(wordCount);
  }

  return contentScore;
}

function calculateTimeScore(created) {
  if (!created) return 0;
  
  const ageInDays = (Date.now() - new Date(created * 1000).getTime()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + ageInDays * 0.05);
}
