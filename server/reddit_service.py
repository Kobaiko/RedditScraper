from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from praw import Reddit
import os
from dotenv import load_dotenv
from typing import Dict, List
import asyncio
from collections import defaultdict
from textblob import TextBlob
import time
from datetime import datetime, timedelta

load_dotenv()

app = FastAPI()

# Update CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "https://redscrape.iamgrowth.co",
        "http://redscrape.iamgrowth.co",
        "https://reddit-scraper-backend.iamgrowth.co",
        "http://reddit-scraper-backend.iamgrowth.co"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Reddit API client
reddit = Reddit(
    client_id=os.getenv('REDDIT_CLIENT_ID'),
    client_secret=os.getenv('REDDIT_CLIENT_SECRET'),
    user_agent='SentimentAnalyzer/1.0'
)

# Rate limiting configuration
RATE_LIMIT_REQUESTS = 30  # Number of requests allowed
RATE_LIMIT_WINDOW = 3600  # Time window in seconds (1 hour)
request_timestamps = []

def check_rate_limit():
    """Check if we're within rate limits"""
    current_time = time.time()
    # Remove timestamps older than the window
    global request_timestamps
    request_timestamps = [ts for ts in request_timestamps if current_time - ts < RATE_LIMIT_WINDOW]
    
    if len(request_timestamps) >= RATE_LIMIT_REQUESTS:
        wait_time = int(RATE_LIMIT_WINDOW - (current_time - request_timestamps[0]))
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded. Please try again in {wait_time} seconds"
        )
    
    request_timestamps.append(current_time)

def analyze_sentiment(text: str) -> str:
    """Analyze sentiment using TextBlob"""
    analysis = TextBlob(text)
    # Convert polarity score to sentiment category
    if analysis.sentiment.polarity > 0.1:
        return "positive"
    elif analysis.sentiment.polarity < -0.1:
        return "negative"
    else:
        return "neutral"

@app.get("/api/reddit/search/{query}")
async def search_reddit(query: str, limit: int = 100) -> Dict:
    try:
        # Check rate limit before processing
        check_rate_limit()
        
        if not query:
            raise HTTPException(status_code=400, detail="Search query cannot be empty")
            
        # Search for submissions
        submissions = reddit.subreddit('all').search(query, limit=limit)
        
        # Process submissions with error handling
        try:
            posts = []
            sentiment_counts = {"positive": 0, "negative": 0, "neutral": 0}
            subreddit_sentiment = defaultdict(lambda: {"positive": 0, "negative": 0, "neutral": 0})
            
            for submission in submissions:
                try:
                    # Basic sentiment analysis with error handling
                    text_content = f"{submission.title} {submission.selftext if hasattr(submission, 'selftext') else ''}"
                    sentiment = analyze_sentiment(text_content)
                    
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
                except Exception as post_error:
                    print(f"Error processing post: {str(post_error)}")
                    continue
            
            return {
                "posts": posts,
                "overall_sentiment": sentiment_counts,
                "total_posts": len(posts),
                "subreddit_sentiment": dict(subreddit_sentiment)
            }
            
        except Exception as processing_error:
            raise HTTPException(
                status_code=500,
                detail=f"Error processing Reddit data: {str(processing_error)}"
            )
            
    except HTTPException as http_error:
        raise http_error
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Server error: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
