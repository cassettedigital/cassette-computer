// FSEvents watch on the music folder (BUG-789). One stream, delivered on its own
// dispatch queue, so no run loop is needed. Each batch of changes calls back into
// Go (cassetteMusicDirChanged); the Go side decides what to read.
#include <CoreServices/CoreServices.h>
#include <dispatch/dispatch.h>

extern void cassetteMusicDirChanged(void);

static void cassetteFSCallback(ConstFSEventStreamRef stream, void *info, size_t n,
                               void *paths, const FSEventStreamEventFlags flags[],
                               const FSEventStreamEventId ids[]) {
    cassetteMusicDirChanged();
}

int cassetteWatchDir(const char *path) {
    CFStringRef p = CFStringCreateWithCString(NULL, path, kCFStringEncodingUTF8);
    if (!p) return 0;
    CFArrayRef paths = CFArrayCreate(NULL, (const void **)&p, 1, &kCFTypeArrayCallBacks);
    CFRelease(p);
    if (!paths) return 0;
    // 2 s latency: a copy of many files arrives as a few batches, not thousands.
    FSEventStreamRef s = FSEventStreamCreate(NULL, &cassetteFSCallback, NULL, paths,
                                             kFSEventStreamEventIdSinceNow, 2.0,
                                             kFSEventStreamCreateFlagNone);
    CFRelease(paths);
    if (!s) return 0;
    FSEventStreamSetDispatchQueue(s, dispatch_queue_create("digital.cassette.musicdir", DISPATCH_QUEUE_SERIAL));
    if (!FSEventStreamStart(s)) {
        FSEventStreamInvalidate(s);
        FSEventStreamRelease(s);
        return 0;
    }
    return 1; // lives for the whole process
}
