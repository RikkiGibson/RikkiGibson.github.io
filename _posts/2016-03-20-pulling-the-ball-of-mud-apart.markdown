---
layout: post
title:  "Pulling the Ball of Mud Apart"
date:   2016-03-20
categories: blog
published: false
---
### A case study in refactoring a view controller in iOS.

Software development is an iterative process. Functionality is tacked on gradually over time, building up the size of classes, and there comes a point when the maintainers of the software say to themselves "how did this turn into such a bloated monstrosity?" The goal of this article is to explore a real case of a view controller bloating out of shape, and what can be done to address it. We are going to find the answers to some questions about communication between view controllers, and how to structure data for a view controller to best consume it.

Over the past year or so I have developed and maintained an iOS app to help people use the buses in Corvallis, Oregon. As I developed it, I continued to come up with new ideas for how to present the data to users and how the users could navigate the data.

- Early on, I just had a couple of table view controllers in which the user could select bus routes, look at the bus stops, and add bus stops to a favorites list.

- I started to pursue a map-based approach to finding bus stops and route information. I used the built-in features of MKMapView that allow simple bits of information to be presented when the user touches a pin on the map.

- There was tons of information that could be useful to users wanting to know details about a bus stop, so I created a table view that would show that information, and shrank the map. The table view has logic to animate in and out of sight when stops are selected or deselected.

- It was suggested to me that users should be able to jump to a location on the map by searching for it. I went for it and came up with a search bar that shrinks into a button when the table view is up, and reveals itself when the table view comes down or the search button is touched.

- What I had also wanted for quite a while, and finally figured out how to do, was to have arrows indicating the direction of travel of a route, and to have a way of showing which stops are part of the selected route and which are not.

<center>
  <div style="display: inline-block; padding: 10px;">
    <img src="/images/blog-corvallis-bus-refactor/early-table-view.jpg" width="213" height="378">
  </div>
  <div style="display: inline-block; padding: 10px;">
    <img src="/images/blog-corvallis-bus-refactor/early-map-view.jpg" width="213" height="320">
  </div>
  <div style="display: inline-block; padding: 10px;">
    <img src="/images/blog-corvallis-bus-refactor/table-view-map-view.jpg" width="250" height="445">
  </div>
  <div style="display: inline-block; padding: 10px;">
    <img src="/images/blog-corvallis-bus-refactor/recent-map-view.jpg" width="250" height="445">
  </div>
  <p style="color:#666666; font-style: italic; font-size: 11pt;">The evolution of my app's UI over time.</p>
</center>

Each time I added a new feature, the app got a little more sophisticated and a little less maintainable. I thought little of it as I was doing it, but eventually my view controller for the Browse view bloated to the following mass:

- 650 lines of code
- 4 delegate implementations
- 11 Interface Builder outlets and 4 actions

This is far from the worst anyone has ever done, but goes beyond the point of reasonable maintainability. In a Massive View Controller, when one component needs to cause something to happen in another component, the one component directly manipulates the other. Big view controllers like this with lots of parts are likely to have things that could be broken out into self-contained components.

My friend Phillip Carter and I recently created a new [back-end server](https://github.com/rikkigibson/corvallis-bus-server) for the app. Previously, I was depending on a server that required me to do some expensive transformations of the data before it would be suitable to use to populate UI. We came up with a new way of modeling the data that would be performant for a variety of UI patterns approaches. I also designed an endpoint that would deliver exactly the data that was needed to display the list of favorite stops so that I could write a really dumb, fast app extension.

However, refactoring my map view to use this new API proved to be a heavy task that I danced around actually doing. The parts of the UI are very coupled: the map needs to do something when you touch a cell in the stop details table. The table needs to do something when you touch a pin on the map. The path of least resistance for implementing these behaviors is to glom it all together onto one [big ball of mud]("https://en.wikipedia.org/wiki/Big_ball_of_mud"). This is the classic maintainability problem in iOS development, called Massive View Controller in mockery of the architecture typically called Model-View-Controller.

### Breaking down the MVC

There is, however, a nice way of allowing these parts to be separated out. All iOS developers have used this pattern before, because it's everywhere in Cocoa. It's called a **delegate**. It's the way that children tell their parents what's going on: A parent view controller produces a child view and retains a reference to it. The parent assigns itself or someone trusted to be its delegate. Then, when the child has something it wants the outside world to know about, it tells the delegate. A delegate is just as useful and valid between a view controller and its child view as a view controller and its child view controller.

Making our own delegates will be key to separating the pieces of this ball of mud.

<!-- TODO: discuss container views and child view controllers -->

The stop details table under the map has a finite set of things it needs to let its delegate know about. It needs to notify its delegate when:

- the user touches the favorite button
- the user taps a row in the table
- the user taps the accessory button on the right side of the table cell.

