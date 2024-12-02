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
  
  // Security software specific sentiment dictionary
  const sentimentDict = {
    // Strong negative terms (-2)
    'virus': -2, 'malware': -2, 'scam': -2, 'spyware': -2, 'ransomware': -2,
    'trojan': -2, 'infected': -2, 'dangerous': -2, 'suspicious': -2,
    'bloatware': -2, 'adware': -2, 'keylogger': -2, 'exploit': -2,
    'breach': -2, 'compromised': -2, 'fraud': -2, 'spam': -2,
    'impossible': -2, 'terrible': -2, 'horrible': -2, 'garbage': -2,
    
    // Moderate negative terms (-1)
    'slow': -1, 'heavy': -1, 'resource': -1, 'cpu': -1, 'memory': -1,
    'expensive': -1, 'costly': -1, 'price': -1, 'crash': -1, 'bug': -1,
    'issue': -1, 'problem': -1, 'error': -1, 'warning': -1, 'cant': -1,
    'difficult': -1, 'annoying': -1, 'uninstall': -1,
    
    // Neutral/Question terms (0)
    'how': 0, 'what': 0, 'why': 0, 'where': 0, 'when': 0,
    'install': 0, 'download': 0, 'update': 0, 'help': 0,
    'difference': 0, 'compare': 0, 'versus': 0, 'vs': 0,
    'recommend': 0, 'suggestion': 0, 'opinion': 0, 'experience': 0,
    
    // Moderate positive terms (1)
    'good': 1, 'works': 1, 'working': 1, 'stable': 1, 'reliable': 1,
    'clean': 1, 'safe': 1, 'secure': 1, 'protect': 1, 'light': 1,
    'fast': 1, 'quick': 1, 'efficient': 1, 'effective': 1,
    'helpful': 1, 'useful': 1, 'worth': 1,
    
    // Strong positive terms (2)
    'excellent': 2, 'perfect': 2, 'best': 2, 'recommended': 2,
    'great': 2, 'awesome': 2, 'amazing': 2, 'fantastic': 2,
    'trustworthy': 2, 'reliable': 2, 'legitimate': 2, 'genuine': 2
  };

  // Question/help-seeking patterns (neutral)
  const neutralPatterns = [
    'is it safe', 'is it legit', 'how to', 'how do i',
    'what is', 'anyone use', 'worth it', 'should i',
    'looking for', 'need help', 'question about'
  ];

  // Warning/negative patterns
  const warningPatterns = [
    'dont install', 'do not install', 'stay away',
    'waste of', 'not worth', 'cant remove', 'cant uninstall'
  ];

  let sentimentScore = 0;
  let wordCount = 0;

  // Check for neutral patterns first
  for (const pattern of neutralPatterns) {
    if (text.includes(pattern)) {
      return 'neutral';
    }
  }

  // Check for warning patterns
  for (const pattern of warningPatterns) {
    if (text.includes(pattern)) {
      return 'negative';
    }
  }

  // Calculate word-based sentiment
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (sentimentDict[word] !== undefined) {
      sentimentScore += sentimentDict[word];
      wordCount++;
    }
  }

  // If no sentiment words found, return neutral
  if (wordCount === 0) {
    return 'neutral';
  }

  // Normalize score
  sentimentScore = sentimentScore / Math.sqrt(wordCount);

  // Add karma influence (reduced weight)
  if (score) {
    const karmaInfluence = Math.log(Math.abs(score) + 1) * Math.sign(score) * 0.1;
    sentimentScore += karmaInfluence;
  }

  // More balanced thresholds for security software context
  if (sentimentScore > 0.3) return 'positive';
  if (sentimentScore < -0.3) return 'negative';
  return 'neutral';
}
}
