---
layout: post
title:  "Better Async Programming with Promises"
date:   2016-03-27
categories: blog
published: true
draft: false
---
### A comprehensible description of how Promises work and how they can improve the structure of an iOS app.

The kinds of stuff we need to get done as mobile developers involves lots of potentially long-running tasks, like network requests, reading and writing to storage, or getting the user's location. If done improperly, these tasks can make the app appear to freeze from the user's perspective and harm their experience. Asynchronous functions are preferred to synchronous functions for any potentially long-running work in app development.

Composition of synchronous functions is achieved by passing the return value of one function as an argument to the next function:

{% highlight swift %}
let userLocation = getUserLocation()
let userData = getDataFromService(userLocation)
updateUI(userData)
{% endhighlight %}

The trouble with this is that the thread executing this code needs to block on anything it encounters that requires long-running work before it can do anything else. If that thread is the main thread, then the main thread can't handle UI events until it's done, which is the same as freezing the app from the user's point of view.

Asynchronous functions help you avoid the problem of blocking threads, but are a bit messier in usage: instead of returning a value, asynchronous functions take a "callback" function as an argument, where the callback is eventually called with the results of the potentially long-running task.

It works alright if only one asynchronous action is needed, but becomes unpleasant when several asynchronous actions need to be composed.

{% highlight swift %}
getUserLocation({ userLocation in
    getDataFromService(userLocation, { userData in
        dispatchToMainThread({
            updateUI(userData)
        })
    })
})
{% endhighlight %}

These examples don't even include any error handling, which you would need to do properly for anything like a network request, I/O or getting the user's location.

{% highlight swift %}
getUserLocation({ (userLocation: CLLocation?, error: NSError?) in
    if let error = error {
        // log it, maybe show a dialog?
    }
    if let userLocation = userLocation {
        getDataFromService(userLocation, { (userData: UserData?, error: NSError?) in
            if let error = error {
                // report this error too, yay!
            }
            if let userData = userData {
                dispatchToMainThread({
                    updateUI(userData)
                })
            }
        })
    }
})
{% endhighlight %}

It's an error-prone, spaghetti-prone pattern.

A Promise is a wrapper around an asynchronous function which mitigates much of the maintainability problems with callback-based code. Asynchronous functions can return Promises instead of consuming callbacks, and they can be composed together easily, kind of like how the return values of synchronous functions were composed together.

{% highlight swift %}
let userLocationPromise = getUserLocation()
let userDataPromise = userLocationPromise.then(getUserData)
userDataPromise.finishOnMainThread(updateUI)
{% endhighlight %}

The `then` function is the core of all of it. `then` takes a function which consumes the result of the previous Promise and returns a new Promise that can also have `then` called on it.

If you're anything like me you probably wonder just how such functionality is implemented. I learned quite a bit from [Javier Soto's Back to the Futures](https://realm.io/news/swift-summit-javier-soto-futures/) talk, but struggled for some time to understand the code examples for his Futures (essentially a synonym for Promises) implementation.

What unlocked it for me was to start thinking of Promises as a linked list of callbacks. Each time you call `aPromise.then()`, you're wrapping an outer Promise around `aPromise`. A simple Promise can be constructed as an immutable value, just like a linked list, and `then()` calls simply serve as a way to assemble the sequence of functions that will eventually be invoked.

## A simple Promise implementation

Let's look at how a simple Promise data type could be implemented in Swift.
{% highlight swift %}
struct Promise<T> {
    typealias CompletionHandler = T -> Void
    typealias AsyncTask = CompletionHandler -> Void
}
{% endhighlight %}

First, a few type aliases to help the code stay understandable. Credit for these goes to Javier Soto. A `CompletionHandler` is a callback: a function that you would pass in to an asynchronous function. An `AsyncTask` is an asynchronous function like the ones described above. The `AsyncTask` consumes the `CompletionHandler` and the `CompletionHandler` is eventually called with some result.

For convenience it's desired to have initializers for Promise that take either an `AsyncTask` or a value that is already available but needs to be delivered in Promise form. For a `result` that is already available, a task function is created that just immediately calls the provided completion handler with the `result` value.

{% highlight swift %}
struct Promise<T> {
    typealias CompletionHandler = T -> Void
    typealias AsyncTask = CompletionHandler -> Void
    
    let task: AsyncTask
    init(task: AsyncTask) {
        self.task = task
    }
    init(result: T) {
        self.task = { (completionHandler: CompletionHandler) in
            completionHandler(result)  
        }
    }
}
{% endhighlight %}

`then` is the critical feature of Promises that enable its style of composition to work. Let's analyze its signature to think about how it should work.

{% highlight swift %}
struct Promise<T> {
    ...
    func then<U>(makeNext: T -> Promise<U>) -> Promise<U> {
        ...
    }
}
{% endhighlight %}

The `then` method consumes a function `makeNext`. `makeNext` consumes the result of the Promise that `then` was called on. `makeNext` returns another Promise containing some other result type `U`. `then` returns a Promise of the same type `U` as contained in the Promise returned by `makeNext`.

The implementation of `then` is short, but dense with meaning and not easy to immediately follow.

{% highlight swift %}
struct Promise<T> {
    ...
    func then<U>(makeNext: T -> Promise<U>) {
        return Promise<U>(task: { (completionHandler: CompletionHandler) in
            self.task({ (innerResult: T) in
                let nextPromise = makeNext(innerResult)
                nextPromise.task(completionHandler)
            })
        })
    }
}
{% endhighlight %}

Let's break this down:

- `self` is the inner Promise. It is started first and once it completes, its result will be passed to some outer Promise.
- Its `task` is called with a completion handler which takes the parameter `innerResult`.
- `innerResult` is passed into the `makeNext` function, which produces a new Promise in the scope of the inner task's completion handler.
- The `task` of the new Promise is called, consuming the completion handler from the outer Promise.

Keep in mind what the eventual usage of the Promise looks like. The whole point is that you *receive* the Promise, and at some later point, you pass in a callback to actually use the result of its work. In this implementation, none of the work actually begins until `task` is called on the outer Promise. Also remember the linked list analogy, where the `then` function works a lot like making a new node, setting its link to point at the head of the existing list, and returning that new node.

Running the task in a Promise will cause the tasks of each successive inner Promise to run, all the way to the innermost Promise. Then the results are passed from the innermost Promise out to each successive outer Promise, all the way out to the outermost Promise where the last completion handler is finally called.

This simple implementation of Promises is as follows:
{% highlight swift %}
struct Promise<T> {
    typealias CompletionHandler = T -> Void
    typealias AsyncTask = CompletionHandler -> Void
    
    let task: AsyncTask
    init(task: AsyncTask) {
        self.task = task
    }
    
    init(result: T) {
        self.task = { completionHandler in
            completionHandler(result)
        }
    }
    
    func then<U>(makeNext: T -> Promise<U>) -> Promise<U> {
        return Promise<U>(task: { completionHandler in
            self.task({ result in
                let nextPromise = makeNext(result)
                nextPromise.task(completionHandler)
            })
        })
    }
}
{% endhighlight %}

And an example usage:

{% highlight swift %}
// pretend this really is async
func modifyStringAsync(s: String) -> Promise<String> {
    return Promise(result: s + s)
}

let p1 = Promise(result: "foo")
let p2 = p1.then(modifyStringAsync)
p2.task({ result in
    print(result) // prints "foofoo"
})
{% endhighlight %}

## Error handling
For simplicity's sake, error handling was omitted from the first implementation, but it's easily added using a similar pattern of method chaining.

First, note that a common pattern for defining error values in Swift is to create an enum that conforms to an empty protocol called `ErrorType`. The cases can be whatever you want. I tend to define the cases based on what I eventually want to do with the error value, but you may have good reasons to take a different approach. My approach could definitely be seen as borrowing presentation concerns which shouldn't be present in a network request handler or what have you.

My experience is that some errors warrant notifying the user in whatever way is contextually appropriate-- often a dialog box, and other errors just seem to occur incidentally. These kinds of incidental errors are disruptive and unhelpful, and it's better not to notify the user when they occur. A common one in my experience is a timeout error that occurs due to the user leaving the app while a network request for that app is underway, which finally surfaces a long time later when the outcome of that request doesn't matter any more.
{% highlight swift %}
enum MyErrorType : ErrorType {
    case Notify(String)
    case Ignore
}
{% endhighlight %}

An enum is used to describe the result of some operation that might either succeed or fail.

{% highlight swift %}
enum Failable<T, E: ErrorType> {
    case Success(T)
    case Error(E)
}
{% endhighlight %}

Instances of Failable are either a Success containing some success value or an Error containing some error value.

The signature of Promise is updated so that it deals with values of type Failable. The notable changes can be seen in `init(result: T)` and in `then`.

`then` needs to be changed so the result of the inner Promise is checked.

- If the inner Promise created a `Success`, the `makeNext` function is used with the inner value of the `Success`.
- If it created an `Error`, the same error of type `E` is passed in to the completion handler of the outer Promise.

The effect of this is that as soon as one of the Promises has an error, the outer Promises just propagate the same error instead of running their tasks using the result of the inner Promise.

{% highlight swift %}
struct Promise<T, E: ErrorType> {
    typealias CompletionHandler = Failable<T, E> -> Void
    typealias AsyncTask = CompletionHandler -> Void
    
    let task: AsyncTask
    init(task: AsyncTask) {
        self.task = task
    }
    
    init(result: T) {
        self.task = { completionHandler in
            completionHandler(.Success(result))
        }
    }
    
    func then<U>(makeNext: T -> Promise<U, E>) -> Promise<U, E> {
        return Promise<U, E>(task: { completionHandler in
            self.task({ result in
                switch result {
                case .Success(let value):
                    let nextPromise = makeNext(value)
                    nextPromise.task(completionHandler)
                case .Error(let error):
                    completionHandler(.Error(error))
                }
            })
        })
    }
}
{% endhighlight %}

The error can be checked either by calling `task` on the outer Promise directly or by adding an overload to `then` which takes a function `Failable<T,E> -> Promise<U,E>`.

## Cancelation, automatic starting, and other amenities
A stateful, more complex Promise implementation allows for a valuable conceptual model: using a Promise as a stand-in for a resource that might not be available yet, which allows one to queue up actions to be performed once it becomes available, or to access the resource synchronously if it's available. It also allows for features like cancellation.

Since the Promise is now stateful, it's better for it to be a class instead of a struct. Instead of being a value that may get copied whenever it's assigned to a variable or passed in to a function, a reference to it will be shared so that any observer can see the changes to it over time.

{% highlight swift %}
enum PromiseState<T, E: ErrorType> {
    case Created
    case Started
    case Finished(Failable<T, E>)
}

class Promise<T, E: ErrorType> {
    private(set) var state = PromiseState<T, E>.Created
    private let task: AsyncTask // this was public before
    ...
    var completionHandlers: [CompletionHandler] = []
    func start(completionHandler: CompletionHandler) {
        switch state {
        case .Created:
            state = .Started
            completionHandlers.append(completionHandler)
            task({ result in
                self.state = .Finished(result)
                for handler in self.completionHandlers {
                    handler(result)
                }
            })
        case .Started:
            completionHandlers.append(completionHandler)
            break
        case .Finished(let result):
            completionHandler(result)
        }
    }
    
    func cancel() {
        completionHandlers = []
    }
}
{% endhighlight %}

Now say we're implementing a table view controller. We can access the resource loaded by the Promise synchronously if available, allowing us to play nice with UIKit with less manual management of resource load state.

{% highlight swift %}
class MyTableViewController : UITableViewController {
    var dataPromise: Promise<[MyDataRowType], MyErrorType> = myServiceClientInstance.getMyData()
    override func tableView(tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        if case .Finished(.Success(let data)) = dataPromise.state {
            return data.count
        } else {
            return 0
        }
    }
}
{% endhighlight %}

## Extending standard APIs to improve usability

Cocoa has aged a bit and its APIs still don't take full advantage of Swift language features (as of March 2016). Take this standard code sample for making a network request:

{% highlight swift %}
let session = NSURLSession.sharedSession()
session.dataTaskWithURL(NSURL(string: "http://google.com/eric-schmidts-yacht-bill-data")!) {
    (data: NSData?, response: NSURLResponse?, error: NSError?) in
    if let error = error {
        dispatch_async(dispatch_get_main_queue()) {
            displayError(error)
        }
    }
    if let data = data {
        let processedData = deserializeAndMaybeOtherStuff(data)
        dispatch_async(dispatch_get_main_queue()) {
            updateUI(processedData)
        }
    }
}.resume() // you will forget to call .resume() half the time
           // and wonder why nothing happens
{% endhighlight %}

Extensions allow us to create methods that feel like they are just as much part of the standard library as what you get out of the box.

{% highlight swift %}
extension NSURLSession {
    func downloadData(url: NSURL) -> Promise<NSData, MyErrorType> {
        let sanitizeAPI = { (data: NSData?, response: NSURLResponse?, error: NSError?) -> Failable<NSData, MyErrorType> in
            if let error = error {
                return .Error(MyErrorType.fromNSError(error))
            } else {
                return .Success(data!)
            }
        }
        
        return Promise({ (completionHandler: Failable<NSData, MyErrorType> -> Void) in
            self.dataTaskWithURL(url, completionHandler: {
                let failable = sanitizeAPI($0, $1, $2)
                completionHandler(failable)
            }).resume()
        })
    }
}

NSURLSession.sharedSession()
            .downloadData("http://yacht-emporium.biz/billion-dollar-yachts")
            .then(processData)
            .start(presentAmazingDealsOrErrorToUser)
{% endhighlight %}

By defining extensions for yourself as needed that return Promises instead of consuming callbacks, you'll be able to work as though Promises are a first-class concept in the standard library.

## Conclusion
Promises are a simple and powerful means of structuring asynchronous programs. Although in real apps you may prefer to use a battle-tested Promises library with nice extensions already defined, they are easy to create yourself in a pinch.

You can check out a [Promise implementation][ghpromise], similar to the one detailed here, that I made for use in an actual app.

[ghpromise]: https://github.com/RikkiGibson/Corvallis-Bus-iOS/blob/master/Shared/Promise.swift