import sys
import json
from praw import Reddit
import os
from textblob import TextBlob
from collections import defaultdict

def analyze_reddit(query):
    try:
        # Initialize Reddit client
        reddit = Reddit(
            client_id=os.environ.get('REDDIT_CLIENT_ID'),
            client_secret=os.environ.get('REDDIT_CLIENT_SECRET'),
            user_agent='SentimentAnalyzer/1.0'
        )

        # Search Reddit
        submissions = reddit.subreddit('all').search(query, limit=100)
        
        posts = []
        sentiment_counts = {"positive": 0, "negative": 0, "neutral": 0}
        subreddit_sentiment = defaultdict(lambda: {"positive": 0, "negative": 0, "neutral": 0})
        
        for submission in submissions:
            try:
                # Analyze sentiment
                text = f"{submission.title} {submission.selftext if hasattr(submission, 'selftext') else ''}"
                analysis = TextBlob(text)
                
                if analysis.sentiment.polarity > 0:
                    sentiment = "positive"
                elif analysis.sentiment.polarity < 0:
                    sentiment = "negative"
                else:
                    sentiment = "neutral"
                
                sentiment_counts[sentiment] += 1
                subreddit_sentiment[submission.subreddit.display_name][sentiment] += 1
                
                posts.append({
                    "id": submission.id,
                    "title": submission.title,
                    "url": submission.url,
                    "score": submission.score,
                    "num_comments": submission.num_comments,
                    "created_utc": submission.created_utc,
                    "subreddit": submission.subreddit.display_name,
                    "sentiment": sentiment
                })
            except Exception as e:
                continue
        
        return {
            "posts": posts,
            "overall_sentiment": sentiment_counts,
            "total_posts": len(posts),
            "subreddit_sentiment": dict(subreddit_sentiment)
        }
        
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No search query provided"}))
        sys.exit(1)
        
    query = sys.argv[1]
    result = analyze_reddit(query)
    print(json.dumps(result))
