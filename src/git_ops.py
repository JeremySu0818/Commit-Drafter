
import subprocess
import sys

def get_git_diff(staged: bool = True) -> str:
    """
    Get the diff of the current repository.
    :param staged: If True, get staged changes (cached). If False, get working directory changes.
    :return: String containing the diff.
    """
    cmd = ["git", "diff"]
    if staged:
        cmd.append("--cached")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, encoding='utf-8')
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error running git diff: {e}")
        return ""
    except Exception as e:
        print(f"Unexpected error: {e}")
        return ""

def is_git_repo() -> bool:
    try:
        subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], capture_output=True, check=True)
        return True
    except subprocess.CalledProcessError:
        return False

def commit_changes(message: str) -> bool:
    """
    Commit the staged changes with the given message.
    """
    try:
        subprocess.run(["git", "commit", "-m", message], check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"Error committing changes: {e}")
        return False
